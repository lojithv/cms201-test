import { DurableObject } from "cloudflare:workers";
import { ObjectAssignAssign, gzipString } from "./tools.js";
import { commit, pullLatestChanges } from "./GitHubCommit.js";

async function sha256base64UrlSafe(uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", uint8Array);
  const out = new Uint8Array(digest);
  let res = "";
  for (let i = 0; i < out.length; i++)
    res += String.fromCharCode(out[i]);
  return btoa(res).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export class EventsSnaps extends DurableObject {

  #currentState;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = this.ctx.storage.sql;
    this.sql.exec(`
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch('now')),
  email     TEXT NOT NULL,
  json      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY            -- 43 chars, URL-safe base64 (no '=')
                COLLATE BINARY             -- case-sensitive (required for base64)
                CHECK (length(id) = 43)
                CHECK (id GLOB '[A-Za-z0-9_-]*'),
  timestamp   INTEGER NOT NULL DEFAULT (unixepoch('now')),
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  data        BLOB NOT NULL
) WITHOUT ROWID;`);
    if (this.#currentState)
      return;

    this.ctx.blockConcurrencyWhile(async _ => {
      const snapR = await this.env.ASSETS.fetch(new URL("/data/snap.json", "https://assets.local"));
      if (!snapR.ok)
        throw new Error("Failed to load initial state: " + snapR.status + " " + snapR.statusText);
      const snap = await snapR.json();
      const filesR = await this.env.ASSETS.fetch(new URL("/data/files.json", "https://assets.local"));
      if (!filesR.ok)
        throw new Error("Failed to load initial files: " + filesR.status + " " + filesR.statusText);
      const files = await filesR.json();
      this.#currentState = { snap, files };
    });
  }

  async readFile(filename) {
    const [type, one] = filename.split("/");
    if (type == "files") {
      const result = this.sql.exec(`SELECT data, mime, name FROM files WHERE id = ?`, one).next().value;
      if (!result) {
        return new Response("File not found", { status: 404 });
      }
      const { data, mime, name } = result;
      return new Response(data, {
        headers: {
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`
        }
      });
    } else if (type == "events") {
      const [[startTime, startId], [endTime, endId]] = one.split(".")[0].split("-").map(s => s.split("_"));
      if (!startTime || !startId || !endTime || !endId)
        throw new Error("Events filename file is corrupted: " + filename);
      const res = this.sql.exec(`SELECT * FROM events WHERE id BETWEEN ? AND ? ORDER BY id ASC`, startId, endId).toArray();
      if (!res || res[0].timestamp != startTime || res[res.length - 1].timestamp != endTime)
        throw new Error("Events filename doesn't match state in DO: " + filename);
      for (const r of res)
        r.json = JSON.parse(r.json);
      const gzArrayBuffer = await gzipString(JSON.stringify(res));
      return new Response(gzArrayBuffer, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    } else if (type == "snap.json" || type == "files.json") {
      return new Response(JSON.stringify(this.#currentState.snap), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    }
    throw new Error("Unknown file: " + filename);
  }

  async addFile(email, { filename, contentType, data }) {
    const id = await sha256base64UrlSafe(data);
    let nameDB = this.sql.exec(`SELECT name FROM files WHERE id = ?`, id).next()?.value?.name;
    if (!nameDB)
      this.sql.exec(`INSERT INTO files (id, email, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)`,
        id, email, (nameDB = filename), contentType, data.byteLength, data);
    return `files/${id}/${nameDB}`;
  }

  getEventFileName() {
    const eA = this.sql.exec(`SELECT * FROM events ORDER BY id ASC LIMIT 1`).next().value;
    if (!eA) return;
    const eZ = this.sql.exec(`SELECT * FROM events ORDER BY id DESC LIMIT 1`).next().value;
    return `${eA.timestamp}_${eA.id}-${eZ.timestamp}_${eZ.id}`;
  }

  /**
   * Pull latest state from GitHub and update local #currentState.
   * This merges remote changes with local state for multi-collaborator sync.
   */
  async pull(githubSettings) {
    const { repo, pat } = githubSettings;
    const rootUrl = `https://api.github.com/repos/${repo}/contents`;

    const pulled = { snap: false, files: false };
    const errors = [];

    // Pull snap.json from GitHub
    try {
      const snapData = await pullLatestChanges(pat, rootUrl, "public/data/snap.json");
      if (snapData && snapData.content) {
        const remoteSnapStr = decodeURIComponent(escape(atob(snapData.content.replace(/\s/g, ''))));
        const remoteSnap = JSON.parse(remoteSnapStr);
        // Merge remote snap with local snap (remote first, then local overwrites)
        // This ensures we get all remote changes, but local uncommitted changes take precedence
        this.#currentState.snap = ObjectAssignAssign(remoteSnap, this.#currentState.snap);
        pulled.snap = true;
      }
    } catch (err) {
      // 404 is ok - file might not exist yet
      if (!err.message.includes("404")) {
        errors.push({ type: "snap", error: err.message });
      }
    }

    // Pull files.json from GitHub
    try {
      const filesData = await pullLatestChanges(pat, rootUrl, "public/data/files.json");
      if (filesData && filesData.content) {
        const remoteFilesStr = decodeURIComponent(escape(atob(filesData.content.replace(/\s/g, ''))));
        const remoteFiles = JSON.parse(remoteFilesStr);
        // Merge remote files list with local files list
        const localFiles = this.#currentState.files || [];
        this.#currentState.files = Array.from(new Set([...remoteFiles, ...localFiles])).sort();
        pulled.files = true;
      }
    } catch (err) {
      // 404 is ok - file might not exist yet
      if (!err.message.includes("404")) {
        errors.push({ type: "files", error: err.message });
      }
    }

    // Clear cached snaps since state changed
    this.#currentState.snaps = {};

    return { 
      status: errors.length === 0 ? "success" : "partial_failure",
      message: `Pulled latest state from GitHub.`,
      pulled,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Unified GitHub sync cycle: Pull → Commit → Cleanup → Pull again
   * Handles multi-collaborator scenarios by syncing in both directions.
   */
  async sync(githubSettings) {
    const { repo, pat } = githubSettings;
    const rootUrl = `https://api.github.com/repos/${repo}/contents`;

    // 1. Pull latest from GitHub first (get changes from other collaborators)
    const pullResult = await this.pull(githubSettings);

    // 2. Gather files to sync
    const filesToSync = this.sql.exec(`SELECT id, name FROM files ORDER BY id DESC`).toArray();
    const eventFileName = this.getEventFileName();
    
    if (!filesToSync.length && !eventFileName) {
      return { 
        status: "nothing_to_sync", 
        message: "No new data to sync to GitHub.",
        pulled: pullResult.pulled
      };
    }

    const syncedItems = [];
    const errors = [];

    // 3. Commit each file to GitHub
    for (const { id, name } of filesToSync) {
      try {
        const result = this.sql.exec(`SELECT data, mime FROM files WHERE id = ?`, id).next().value;
        if (!result) continue;

        const { data, mime } = result;
        const githubPath = `public/data/files/${id}/${encodeURIComponent(name)}`;
        
        // Convert binary to base64 string for GitHub API
        let content;
        if (mime.startsWith("text/") || mime === "application/json") {
          content = new TextDecoder().decode(data);
        } else {
          // Binary file - encode as base64 data URI or raw bytes
          content = btoa(String.fromCharCode(...new Uint8Array(data)));
        }

        await commit(pat, rootUrl, githubPath, null, null, content);
        syncedItems.push({ type: "file", id, name });
      } catch (err) {
        errors.push({ type: "file", id, name, error: err.message });
      }
    }

    // 4. Commit events file (gzipped)
    if (eventFileName) {
      try {
        const eventsRes = await this.readFile(`events/${eventFileName}.json.gz`);
        if (eventsRes.ok) {
          const gzipData = await eventsRes.arrayBuffer();
          const content = btoa(String.fromCharCode(...new Uint8Array(gzipData)));
          const githubPath = `public/data/events/${eventFileName}.json.gz`;
          
          await commit(pat, rootUrl, githubPath, null, null, content);
          syncedItems.push({ type: "events", fileName: eventFileName });
        }
      } catch (err) {
        errors.push({ type: "events", fileName: eventFileName, error: err.message });
      }
    }

    // 5. Commit snap.json with merge logic
    try {
      const snapContent = JSON.stringify(this.#currentState.snap, null, 2);
      await commit(pat, rootUrl, "public/data/snap.json", null, (newS, oldS) => {
        if (!oldS) return newS;
        const old = JSON.parse(oldS);
        const current = JSON.parse(newS);
        return JSON.stringify({ ...old, ...current }, null, 2);
      }, snapContent);
    } catch (err) {
      errors.push({ type: "snap", error: err.message });
    }

    // 6. Commit files.json with merge logic
    try {
      const newFilesList = filesToSync.map(f => `files/${f.id}/${encodeURIComponent(f.name)}`);
      if (eventFileName) newFilesList.push(`events/${eventFileName}.json.gz`);
      
      await commit(pat, rootUrl, "public/data/files.json", null, (newFListJson, oldFListJson) => {
        const existingFiles = oldFListJson ? JSON.parse(oldFListJson) : [];
        const newFiles = JSON.parse(newFListJson);
        return JSON.stringify(Array.from(new Set([...existingFiles, ...newFiles])).sort(), null, 2);
      }, JSON.stringify(newFilesList));
    } catch (err) {
      errors.push({ type: "files.json", error: err.message });
    }

    // 7. On success, cleanup synced data from DO
    if (errors.length === 0) {
      // Delete synced files from DO
      for (const { id } of filesToSync) {
        this.sql.exec(`DELETE FROM files WHERE id = ?`, id);
      }

      // Delete synced events from DO
      if (eventFileName) {
        const [[, startId], [, endId]] = eventFileName.split("-").map(s => s.split("_"));
        this.sql.exec(`DELETE FROM events WHERE id BETWEEN ? AND ?`, startId, endId);
      }

      // 8. Pull again to ensure we have the absolute latest state
      const finalPullResult = await this.pull(githubSettings);

      return { 
        status: "success", 
        message: `Synced ${syncedItems.length} items to GitHub.`,
        synced: syncedItems,
        pulled: finalPullResult.pulled
      };
    } else {
      return { 
        status: "partial_failure", 
        message: `Some items failed to sync.`,
        synced: syncedItems,
        errors 
      };
    }
  }

  getEvents(id) {
    if (id) {
      const res = this.sql.exec(`SELECT * FROM events WHERE id=?`, id).next().value;
      res.json = JSON.parse(res.json);
      return res;
    }
    const res = this.sql.exec(`SELECT * FROM events`).toArray();
    for (const r of res)
      r.json = JSON.parse(r.json);
    return res;
  }

  async addEvent(email, json) {
    this.sql.exec(`INSERT INTO events (email, json) VALUES (?, ?)`, email, JSON.stringify(json));
    const snap = ObjectAssignAssign(this.#currentState.snap, json);
    return this.#currentState = { ...this.#currentState, snap };
  }

  async getSnap(name, cb) {
    if (!name) return this.#currentState.snap;
    if (!cb) throw new Error("You must provide a callback to process the snap in order to get a custom snap.");
    return (this.#currentState.snaps ??= {})[name] ??= cb(this.#currentState.snap);
  }
}