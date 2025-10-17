import { getAuthGoogleUser } from "./googleAuth.js";
export { EventsSnaps } from "./EventSnapsDO.js";

const DB = env => env["EVENTS_SNAPS"].get(env["EVENTS_SNAPS"].idFromName("foo"));

const UNSECURE_SAME_SITE_PATHS = {
	"GET /api/snap": async function (req, env, ctx) {
		return await DB(env).getSnap();
	},
	"GET /api/snap/notNull": async function (req, env, ctx) {
		return await DB(env).getSnap("notNull", function cleanNotNull(snap) {
			if (!(snap && typeof snap === "object")) return snap;
			if (Array.isArray(snap)) return snap.map(clean);
			const res = {};
			for (const [k, v] of Object.entries(snap)) {
				const cv = cleanNotNull(v);
				if (cv != null)
					res[k] = cv;
			}
			return res;
		});
	},
	"GET /api/uploaded-images": async function (req, env, ctx) {
		const { image_server: { account_id, api_token } } = env.settings;
		// required paginating to retrieve all images in cloudfare images (100 imgs/page default)
		let page = 1;
		let imgURLs = [];
		while (true) {
			const url = `https://api.cloudflare.com/client/v4/accounts/${account_id}/images/v1?page=${page}`;
			const response = await fetch(url, { headers: { "Authorization": `Bearer ${api_token}` } });
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
	"GET /api/readFile": async function (req, env, ctx) {
		return await DB(env).readFile(req.url.pathname.replace("/api/readFile/", ""));
	},
};

const UNSECURE_PATHS = {
	"GET /auth/login": function (req, env, ctx) {
		const { client_id, redirect_uri } = env.settings.google;
		const state = req.url.pathname == "/auth/login" ? "/" :
			req.url.pathname;

		return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?` +
			new URLSearchParams({
				client_id,
				redirect_uri,
				response_type: "code",
				scope: "openid email profile",
				access_type: "online",
				prompt: "consent",
				state,
			}), 302);
	},
	"GET /auth/logout": function (req, env, ctx) {
		return new Response(null, {
			status: 302, headers: {
				"Location": "/",
				"Set-Cookie": `session_token=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax`,
			}
		});
	},
	"GET /auth/callback": async function (req, env, ctx) {
		const code = req.url.searchParams.get("code");
		const state = req.url.searchParams.get("state") || "/";

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
		//todo doesn't the tokenData contain the state too? should we not read it from there?
		return new Response(null, {
			status: 302, headers: {
				"Location": state,
				"Set-Cookie": `session_token=${tokenData.id_token}; HttpOnly; Secure; Path=/; Max-Age=7200; SameSite=Lax`,
			}
		});
	}
};

const GITHUB_SECURE_PATHS = {
	"GET /api/github/syncStart": async function (req, env) {
		return await DB(env).syncStart();
	},
	"POST /api/github/syncEnd": async function (req, env) {
		const files = await req.text();
		return await DB(env).syncEnd(files);
	},
	"GET /api/github/readFile": async function (req, env) {
		return await DB(env).readFile(req.url.pathname.replace("/api/github/readFile/", ""));
	},
};

const SECURE_PATHS = {
	"GET /api/events": async function (req, env, ctx) {
		const pathParts = req.url.pathname.split("/");
		const id = pathParts[3]; // /api/events/{id}
		if (id)
			return DB(env).getEvents(Number(id));
		return DB(env).getEvents();
	},
	"GET /admin": function (req, env, ctx, user) {
		return env.ASSETS.fetch(req);
	},
	"GET /data": async function (req, env, ctx, user) {
		const res = await env.ASSETS.fetch(req);
		if (res.ok)
			return res;
		return DB(env).readFile(req.url.pathname.replace("/data/", ""));
	},
	"POST /api/addEvent": async function (req, env, ctx, user) {
		const json = await req.json();
		if (!json || typeof json !== "object" || !Object.keys(json).length)
			throw new Error("You can only add a non-empty json object as event data.");
		return await DB(env).addEvent(user, json);
	},
	"POST /api/addFile": async function (req, env, ctx, user) {
		const formData = await req.formData();
		const file = formData.get("file");
		if (!(file instanceof File))
			throw new Error("You can only add a file.");
		const filename = formData.get("filename") || file.name;
		if (!filename)
			throw new Error("Filename is required.");
		const contentType = formData.get("contentType") || file.type; // this we do on deliver || "application/octet-stream";
		const arrayBuffer = await file.arrayBuffer();
		if (!arrayBuffer || !arrayBuffer.byteLength)
			throw new Error("File is empty.");
		const uint8Array = new Uint8Array(arrayBuffer);
		return await DB(env).addFile(user, { filename, contentType, data: uint8Array });
	},
	"GET /api/backup": async function (req, env, ctx, user) {
		const res = await fetch(env.settings.github.workflow, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${env.settings.github.pat}`,
				'X-GitHub-Api-Version': '2022-11-28',
				"Accept": "application/vnd.github+json",
				'User-Agent': 'cms201-worker/1.0'
			},
			body: JSON.stringify({ ref: 'main' }),
		});
		if (!res.ok)
			throw new Error("Error triggering backup workflow: " + await res.text());
		return "ok. backup initiated."
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

function getEndpoint(req, PATHS) {
	const path = req.method + " " + req.url.pathname;
	if (path in PATHS) return PATHS[path];
	for (let key in PATHS)
		if (path.startsWith(key + "/"))
			return PATHS[key];
}

async function settings(env) {
	return {
		origin: env.ORIGIN,
		users: Object.fromEntries(env.USERS.split(";").map(up => up.split(":"))),
		google: {
			client_id: env.GOOGLE_ID,
			client_secret: env.GOOGLE_SECRET,
			redirect_uri: env.GOOGLE_REDIRECT,
		},
		github: {
			repo: env.GITHUB_REPO,
			pat: env.GITHUB_PAT,
			workflow: env.GITHUB_WORKFLOW,
			// coder: await AesGcmHelper.make(env.GITHUB_PASSPHRASE),
			ttl: Number(env.GITHUB_TTL) * 60 * 1000,
		},
		image_server: {
			account_id: env.IMAGE_SERVER_ACCOUNT_ID,
			api_token: env.IMAGE_SERVER_API_TOKEN
		}
	};
}

function getCookie(request, name) {
	return request.headers.get("Cookie")
		?.split(";")
		.map(c => c.trim().split("="))
		.findLast(c => c[0] === name)?.[1] || null;
}

async function onFetch(request, env, ctx) {
	try {
		env.settings ??= await settings(env);

		Object.defineProperty(request, "url", { value: new URL(request.url) });
		let endPoint = getEndpoint(request, UNSECURE_PATHS);
		if (!endPoint) {  //validate that checking CORS manually for api endpoints like this is ok
			endPoint = getEndpoint(request, UNSECURE_SAME_SITE_PATHS);
			if (endPoint && !request.headers.get("Referer")?.startsWith(request.url.origin))
				throw "CORS error: Referer not same site";
		}									//validate end
		if (!endPoint) {
			endPoint = getEndpoint(request, GITHUB_SECURE_PATHS);
			if (endPoint) {
				const authHeader = request.headers.get("Authorization");
				if (!authHeader?.startsWith("Bearer "))
					throw "Missing Authorization Bearer token";
				// For now, just check if token matches PAT - in production you might want stronger validation
				const token = authHeader.split("Bearer ")[1];
				if (token !== env.settings.github.pat)
					throw "Invalid GitHub token";
			}
		}
		let user;
		if (!endPoint) {
			endPoint = getEndpoint(request, SECURE_PATHS);
			if (endPoint) {
				let payload = getAuthGoogleUser(getCookie(request, "session_token"), env.settings);
				if (payload instanceof Promise)
					payload = await payload;
				user = payload?.email;
				if (!user)
					endPoint = UNSECURE_PATHS["GET /auth/login"];
			}
		}
		if (!endPoint)
			throw "no endPoint found";

		let res = endPoint(request, env, ctx, user);
		if (res instanceof Promise)
			res = await res;
		return res instanceof Response ? res :
			(typeof res === "string") ? new Response(res) :
				new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json", } });
	} catch (error) {
		console.log(error, request.url); // we can store the errors in the durable object?
		return new Response(`Error. ${Date.now()}.`, { status: 500 });//or, redirect to frontPage always??
	}
}

async function onSchedule(controller, env, ctx) {
	env.settings ??= settings(env);
	await SECURE_PATHS["GET /api/backup"](undefined, env, ctx);
}

export default {
	fetch: onFetch,
	// schedule: onSchedule,
};