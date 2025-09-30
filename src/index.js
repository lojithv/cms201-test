// External dependencies
import { getAuthGoogleUser } from "./googleAuth.js";

// Internal module exports
export { EventsSnaps } from "./EventSnapsDO.js";

// === UTILITY FUNCTIONS ===
/**
 * Get Durable Object instance by class name and identifier
 * @param {string} clazz - The Durable Object class name
 * @param {string} name - The identifier for the DO instance
 * @param {Object} env - Environment bindings
 * @returns {Object} Durable Object instance
 */
const getDo = (clazz, name, env) => env[clazz].get(env[clazz].idFromName(name));

/**
 * Get database instance (EventsSnaps Durable Object)
 * @param {Object} env - Environment bindings
 * @returns {Object} EventsSnaps DO instance
 */
const DB = env => getDo("EVENTS_SNAPS", "foo", env);

/**
 * Extract cookie value from request headers
 * @param {Request} request - The incoming request
 * @param {string} name - Cookie name to extract
 * @returns {string|null} Cookie value or null if not found
 */
function getCookie(request, name) {
	return request.headers.get("Cookie")
		?.split(";")
		.map(c => c.trim().split("="))
		.findLast(c => c[0] === name)?.[1] || null;
}

// === CORS UTILITIES ===
/**
 * Validate if origin is allowed based on CORS configuration
 * @param {string} origin - Request origin
 * @param {Array<string>} allowedOrigins - List of allowed origins
 * @returns {boolean} True if origin is allowed
 */
function validateOrigin(origin, allowedOrigins) {
	if (!origin || !allowedOrigins.length) return false;
	return allowedOrigins.some(allowed => {
		// Exact match
		if (allowed === origin) return true;
		// Subdomain match (e.g., *.example.com)
		if (allowed.startsWith('*.')) {
			const domain = allowed.slice(2);
			return origin.endsWith('.' + domain) || origin === domain;
		}
		return false;
	});
}

/**
 * Set CORS headers on response if origin is allowed
 * @param {Response} response - Response object to modify
 * @param {string} origin - Request origin
 * @param {Array<string>} allowedOrigins - List of allowed origins
 * @returns {Response} Modified response with CORS headers
 */
function setCorsHeaders(response, origin, allowedOrigins) {
	if (validateOrigin(origin, allowedOrigins)) {
		response.headers.set('Access-Control-Allow-Origin', origin);
		response.headers.set('Access-Control-Allow-Credentials', 'true');
		response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
		response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	}
	return response;
}

// === ROUTING CONFIGURATION ===
/**
 * Public endpoints - no authentication required
 */
const PATHS = {
	"OPTIONS": function (req, env, ctx) {
		const origin = req.headers.get('Origin');
		const response = new Response(null, { status: 204 });
		return setCorsHeaders(response, origin, env.settings.cors.allowedOrigins);
	},
	"GET /api/events": async function (req, env, ctx) {
		return await DB(env).getEvents();
	},
	"GET /api/snap": async function (req, env, ctx) {
		const name = req.url.searchParams.get("name");
		const snap = await DB(env).getSnap(name);
		return snap?.value || {};
	},
	"GET /api/uploaded-images": async function(req, env, ctx) {
		const { image_server: { account_id, api_token } } = env.settings;
		// Required paginating to retrieve all images in Cloudflare Images (100 imgs/page default)
		let page = 1;
		let imgURLs = [];
		while (true) {
			const url = `https://api.cloudflare.com/client/v4/accounts/${account_id}/images/v1?page=${page}`;
			const response = await fetch(url, {headers: { "Authorization": `Bearer ${api_token}` }});
			if (!response.ok)
				break;
			const { images } = (await response.json()).result;
			if (!images || (images && !images.length))
				break;
			const urls = images.filter(img => !img.requiredSignedURLs).map(img => img.variants[0]);
			imgURLs = [...imgURLs, ...urls];
			if (images.length < 100)
				break;
			page++;
		}
		return imgURLs;
	},
	"GET /auth/login": function (req, env, ctx) {
		const { client_id, redirect_uri } = env.settings.google;
		let state;
		if (req.url.pathname.startsWith("/auth/login")) {
			const referrer = req.headers.get("Referer");
			state = referrer && referrer.startsWith(req.url.origin) ?
				referrer :
				"/";
		} else
			state = req.url;
		const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
			new URLSearchParams({
				client_id,
				redirect_uri,
				response_type: "code",
				scope: "openid email profile",
				access_type: "online",
				prompt: "consent",
				state,
			});
		return Response.redirect(oauthUrl, 302);
	},
	"GET /auth/logout": function (req, env, ctx) {
		return new Response("ok. Logged out.", {
			status: 200,
			headers: {
				"Set-Cookie": `session_token=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax`,
				"Location": "/",
			},
		});
	},
	"GET /auth/callback": async function (req, env, ctx) {
		const code = req.url.searchParams.get("code");
		const state = req.url.searchParams.get("state");
		const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				code,
				...env.settings.google,
				grant_type: "authorization_code",
			}),
		});
		if (!tokenRes.ok)
			return new Response(`Authentication Failed!`, { status: 401 });
		const tokenData = await tokenRes.json();
		const headers = {
			"Location": state || "/",
			"Set-Cookie": `session_token=${tokenData.id_token}; HttpOnly; Secure; Path=/; Max-Age=7200; SameSite=Lax`,
		};
		return new Response(null, { status: 302, headers });
	}
};

/**
 * Authenticated endpoints - requires valid user session
 */
const SECURE_PATHS = {
	"POST /api/event": async function (req, env, ctx, user) {
		const json = await req.json();
		return await DB(env).addEvent(user, json);
	},
	"GET /auth/checkLogin": async function (req, env, ctx, user) {
		return "ok. Already authenticated.";
	},
	"GET /api/uploadImageURL": async function (req, env, ctx, user) {
		const { image_server: { account_id, api_token } } = env.settings;
		const id = req.url.searchParams.get("path");
		if (!id)
			throw new Error("error. /api/uploadImageURL?id= is required.");
		const formData = new FormData();
		const metadata = {};
		formData.append("id", id);
		if (req.url.searchParams.get("toDelete"))
			metadata["delete"] = true;
		formData.append("metadata", JSON.stringify(metadata));
		const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account_id}/images/v2/direct_upload`, {
			method: "POST",
			headers: { "Authorization": `Bearer ${api_token}` },
			body: formData
		});
		if (!response.ok)
			throw new Error("Error uploading image: " + response.statusText);
		return (await response.json()).result.uploadURL;
	},
};

/**
 * Super user endpoints - requires admin privileges
 */
const SUPER_PATHS = {
	"POST /api/requestRollback": async function (req, env, ctx, user) {
		const newEvents = await req.json();
		await DB(env).requestRollback(newEvents, req.url.origin, env.settings);
		return "ok. rollback requested."
	},
	"GET /api/confirmRollback": async function (req, env, ctx, user) {
		const id = req.url.searchParams.get("id");
		await DB(env).confirmRollback(id, req.url.origin, env.settings);
		return "ok. rollback executed.";
	},
	"GET /api/backup": async function (req, env, ctx, user) {
		await DB(env).backup(env.settings);
		return "ok. backup created.";
	},
};

/**
 * Static asset endpoints
 */
const ASSETS_PATHS = {
	"GET /admin/": async function (req, env) {
		return env.ASSETS.fetch(new Request(`${req.url.origin}/admin/`, req.headers));
	},
	"GET /": async function (req, env) {
		return env.ASSETS.fetch(new Request(`${req.url.origin}/`, req.headers));
	}
};

// === ROUTING LOGIC ===
/**
 * Find endpoint handler in specified path configuration
 * @param {Request} req - The incoming request
 * @param {Object} PATHS - Path configuration object
 * @returns {Function|undefined} Endpoint handler function or undefined
 */
function getEndpoint(req, PATHS) {
	const path = req.method + " " + req.url.pathname;
	for (let key in PATHS)
		if (path.startsWith(key))
			return PATHS[key];
}

/**
 * Find appropriate endpoint and determine authentication requirements
 * @param {Request} req - The incoming request
 * @returns {Object} Object containing endpoint and auth requirements
 */
function findEndPoint(req) {
	let endPoint;
	if (endPoint = getEndpoint(req, PATHS))
		return { endPoint };
	if (endPoint = getEndpoint(req, SECURE_PATHS))
		return { endPoint, needsUser: true };
	if (endPoint = getEndpoint(req, SUPER_PATHS))
		return { endPoint, needsUser: true, needsSuperUser: true };
	if (req.url.pathname.startsWith("/admin/"))
		return { endPoint: ASSETS_PATHS["GET /admin/"], needsUser: true };
	return { endPoint: ASSETS_PATHS["GET /"] };
}

/**
 * Validate endpoint access and return appropriate handler
 * @param {Function} endPoint - The endpoint handler function
 * @param {Object} env - Environment bindings
 * @param {string} user - Authenticated user email
 * @param {Object} options - Authentication requirements
 * @returns {Function} Final endpoint handler
 */
function checkEndpoint(endPoint, env, user, { needsSuperUser, needsUser }) {
	if (needsUser && !user)
		return PATHS["GET /auth/login"];
	if (needsSuperUser && !env.settings.backup.emails.includes(user))
		throw new Error("Unauthorized. Admin user rights required.");
	return endPoint;
}

// === SETTINGS MANAGEMENT ===
/**
 * Parse and validate environment variables into structured settings
 * @param {Object} env - Environment bindings
 * @returns {Object} Structured settings object with defaults and validation
 */
function parseSettings(env) {
	return {
		resend: env.RESEND,
		domain: env.DOMAIN,
		backup: {
			full: {
				time: Number(env.BACKUP_FULLTIME || 7) * 24 * 3600000, // Default 7 days
				events: Number(env.BACKUP_FULLEVENTS || 1000), // Default 1000 events
			},
			partial: {
				time: Number(env.BACKUP_PARTIALTIME || 1) * 24 * 3600000, // Default 1 day
				events: Number(env.BACKUP_PARTIALEVENTS || 100), // Default 100 events
			},
			emails: (env.BACKUP_EMAILS || "").split(";").filter(email => email.trim())
		},
		google: {
			client_id: env.GOOGLE_ID,
			client_secret: env.GOOGLE_SECRET,
			redirect_uri: env.GOOGLE_REDIRECT,
		},
		image_server: {
			account_id: env.IMAGE_SERVER_ACCOUNT_ID,
			api_token: env.IMAGE_SERVER_API_TOKEN
		},
		cors: {
			allowedOrigins: (env.CORS_ALLOWED_ORIGINS || "").split(",").filter(origin => origin.trim())
		}
	};
}

// === MAIN HANDLERS ===
/**
 * Main fetch handler for incoming requests
 * @param {Request} request - The incoming request
 * @param {Object} env - Environment bindings
 * @param {Object} ctx - Execution context
 * @returns {Response} HTTP response
 */
async function onFetch(request, env, ctx) {
	try {
		// Initialize settings if not already parsed
		env.settings ??= parseSettings(env);
		
		// Enhance request object with URL parsing
		Object.defineProperty(request, "url", { value: new URL(request.url) });
		
		// Determine endpoint and authentication requirements
		const { endPoint, needsUser, needsSuperUser } = findEndPoint(request);
		let user;
		
		// Handle authentication if required
		if (needsUser) {
			let payload = getAuthGoogleUser(getCookie(request, "session_token"), env.settings);
			if (payload instanceof Promise)
				payload = await payload;
			user = payload?.email;
		}
		
		// Validate permissions and get final endpoint
		const finalEndPoint = checkEndpoint(endPoint, env, user, { needsSuperUser, needsUser });
		
		// Execute endpoint handler
		let res = finalEndPoint(request, env, ctx, user);
		if (res instanceof Promise)
			res = await res;
		
		// Normalize response format
		const origin = request.headers.get('Origin');
		let response = res instanceof Response ? res :
			(typeof res === "string") ? new Response(res) :
				new Response(JSON.stringify(res), { headers: { "Content-Type": "application/json", } });
		
		// Apply CORS headers if origin is present
		if (origin) {
			response = setCorsHeaders(response, origin, env.settings.cors.allowedOrigins);
		}
		
		return response;
	} catch (error) {
		console.log(error, request.url);
		// Return generic error response for security
		return new Response(`Error. ${Date.now()}.`, { status: 500 });
	}
}

/**
 * Scheduled event handler for automated tasks
 * @param {Object} controller - Scheduled event controller
 * @param {Object} env - Environment bindings
 * @param {Object} ctx - Execution context
 */
async function onSchedule(controller, env, ctx) {
	env.settings = parseSettings(env);
	await DB(env).backup(env.settings);
}

// === MODULE EXPORTS ===
/**
 * Default export - Cloudflare Worker entry point
 */
export default {
	fetch: onFetch,
	scheduled: onSchedule,
};
