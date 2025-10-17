import { DurableObject } from "cloudflare:workers";
import { ObjectAssignAssign } from "./tools.js";

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
  #syncStart;

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
      return new Response(JSON.stringify(res), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    } else if (type == "snap.json") {
      return new Response(JSON.stringify(this.#currentState.snap), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="snap.json"'
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
        id, email, nameDB = filename, contentType, data.byteLength, data);
    return `files/${id}/${nameDB}`;
  }

  getEventFileName() {
    const eA = this.sql.exec(`SELECT * FROM events ORDER BY id ASC LIMIT 1`).next().value;
    if (!eA) return;
    const eZ = this.sql.exec(`SELECT * FROM events ORDER BY id DESC LIMIT 1`).next().value;
    return `${eA.timestamp}_${eA.id}-${eZ.timestamp}_${eZ.id}`;
  }

  syncStart() {
    const res = this.sql.exec(`SELECT name FROM files ORDER BY id DESC`).toArray().map(r => `files/${encodeURIComponent(r.name)}`);
    const eventFile = this.getEventFileName();
    if (eventFile)
      res.push(`events/${eventFile}.json.gz`);
    if (!res.length)
      return "";
    res.push("snap.json");
    return this.#syncStart = res.join(" ");
  }

  syncEnd(files) {
    if (!this.#syncStart)
      throw new Error("You must call syncStart before syncEnd.");
    if (files !== this.#syncStart)
      throw new Error("The files list does not match the one from syncStart.");

    for (const f of files.split(" ")) {
      const [type, one] = f.split("/");
      if (type == "files")
        this.sql.exec(`DELETE FROM files WHERE name = ?`, one);
      else if (type == "events") {
        const [[startTime, startId], [endTime, endId]] = one.split(".")[0].split("-").map(s => s.split("_"));
        if (!startTime || !startId || !endTime || !endId)
          throw new Error("Events filename file is corrupted: " + f);
        this.sql.exec(`DELETE FROM events WHERE id BETWEEN ? AND ?`, startId, endId);
      } else if (type == "snap.json") {
      } else
        throw new Error("Unknown file: " + filename);
    }
    this.#syncStart = null;
  }

  getEvents() {
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