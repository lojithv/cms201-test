import { getAuthGoogleUser } from "./googleAuth.js";
export { EventsSnaps } from "./EventSnapsDO.js";

const DB = env => env["EVENTS_SNAPS"].get(env["EVENTS_SNAPS"].idFromName("foo"));

const UNSECURE_SAME_SITE_PATHS = {
	"GET /api/events": async function (req, env, ctx) {
		return await DB(env).getEvents();
	},
	"GET /api/snap": async function (req, env, ctx) {
		const name = req.url.searchParams.get("name");
		return await DB(env).getSnap(name);
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
};

const UNSECURE_PATHS = {
	// added this v
	// "GET /": function (req, env, ctx) {
	// 	return env.ASSETS.fetch(req);
	// },
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

const SECURE_PATHS = {
	"GET /admin/": function (req, env, ctx, user) {
		return env.ASSETS.fetch(req);
	},
	"POST /api/event": async function (req, env, ctx, user) {
		const json = await req.json();
		return await DB(env).addEvent(user, json);
	},
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
		const db = DB(env);
		const events = await db.getEventsSinceLastBackup();
		if (!events || events.length <= 1) return "ok. no changes to backup.";
		const eventsToBackup = events.slice(1);
		const lastEvent = eventsToBackup[eventsToBackup.length - 1];
		if (lastEvent.timestamp === new Date().getTime()) return "ok. waiting for timestamp difference.";
		const firstEvent = eventsToBackup[0];
		const fileName = `${firstEvent.timestamp}_${firstEvent.id}_${lastEvent.timestamp}_${lastEvent.id}.json`;
		
		// Use your own repository where you have access
		const targetRepo = env.REPO || 'calebdaradal/cms555';
		console.log("Dispatching to repo:", targetRepo);
		console.log("Using GitHub PAT:", env.GITHUB_PAT ? `${env.GITHUB_PAT.substring(0, 10)}...` : 'NOT SET');
		console.log("File path:", `data/events/${fileName}`);
		
		const requestBody = {
			ref: 'main',
			inputs: {
				file_path: `data/events/${fileName}`,
				file_content: JSON.stringify(eventsToBackup, null, 2)
			}
		};
		console.log("Request body:", JSON.stringify(requestBody, null, 2));
		
		const response = await fetch(
			`https://api.github.com/repos/${targetRepo}/actions/workflows/worker-events.yml/dispatches`,
			{
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${env.GITHUB_PAT}`,
					'Accept': 'application/vnd.github+json',
					'Content-Type': 'application/json',
					'X-GitHub-Api-Version': '2022-11-28',
					'User-Agent': 'cms201-backup-worker/1.0'
				},
				body: JSON.stringify(requestBody)
			}
		);
		//this is always 204, we need to poll
		console.log("Response status:", response.status);
		console.log("Response headers:", Object.fromEntries(response.headers.entries()));
		
		if (!response.ok) {
			const errorText = await response.text();
			console.log("Error response body:", errorText);
			throw new Error(`GitHub workflow dispatch failed: ${response.status} - ${errorText}`);
		}
		
		ctx.waitUntil((async () => {
			try {
				//todo here we need to delete events from the db that are older than the last successful backup
				//todo also, we need to poll for new /data/pages.json and /data/snaps.json to see if the events we have are backed up.
				await new Promise(resolve => setTimeout(resolve, 5000));
				await db.cleanupEventsBeforeKey(lastEvent.id);
				await db.markSuccessfulGithubBackup(lastEvent.id);
			} catch (error) {
				await db.markFailedGithubBackup(error, lastEvent.id);
			}
		})());
		return "ok. backup initiated.";
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
	for (let key in PATHS)
		if (path.startsWith(key))
			return PATHS[key];
}

function parseSettings(env) {
	return {
		domain: env.DOMAIN,
		// backup: {
		// 	full: {
		// 		time: Number(env.BACKUP_FULLTIME) * 24 * 3600000,
		// 		events: env.BACKUP_FULLEVENTS,
		// 	},
		// 	partial: {
		// 		time: Number(env.BACKUP_PARTIALTIME) * 24 * 3600000,
		// 		events: env.BACKUP_PARTIALEVENTS,
		// 	},
		// 	to: env.BACKUP_EMAIL_TO,
		// 	from: env.BACKUP_EMAIL_FROM,
		// },
		users: Object.fromEntries(env.USERS.split(";").map(up => up.split(":"))),
		google: {
			client_id: env.GOOGLE_ID,
			client_secret: env.GOOGLE_SECRET,
			redirect_uri: env.GOOGLE_REDIRECT,
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
		env.settings ??= parseSettings(env);
		Object.defineProperty(request, "url", { value: new URL(request.url) });
		let endPoint = getEndpoint(request, UNSECURE_PATHS);
		if (!endPoint) {  //validate that checking CORS manually for api endpoints like this is ok
			endPoint = getEndpoint(request, UNSECURE_SAME_SITE_PATHS);
			if (endPoint && !request.headers.get("Referer")?.startsWith(request.url.origin))
				throw "CORS error: Referer not same site";
		}									//validate end
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
				new Response(JSON.stringify(res), { status: 500, headers: { "Content-Type": "application/json", } });
	} catch (error) {
		console.log(error, request.url); // we can store the errors in the durable object?
		return new Response(`Error. ${Date.now()}.`, { status: 500 });//or, redirect to frontPage always??
	}
}

// async function onSchedule(controller, env, ctx) {
// 	env.settings = parseSettings(env);
// 	await DB(env).backup(env.settings);
// }

export default {
	fetch: onFetch,
};
