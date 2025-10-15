import { DurableObject } from "cloudflare:workers";
import { ObjectAssignAssign } from "./tools.js";

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
  id        TEXT PRIMARY KEY NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch('now')),
  email     TEXT NOT NULL,
  name      TEXT NOT NULL,
  mime      TEXT NOT NULL,
  data      BLOB NOT NULL
);`);
    if (this.#currentState)
      return;

    let resolveState;
    this.#currentState = new Promise(r => resolveState = r);
    this.ctx.waitUntil(async _ => {
      const res = await this.env.ASSETS.fetch(new URL("public/data/state.json", "https://assets.local"));
      if (!res.ok)
        throw new Error("Failed to load initial state: " + res.status + " " + res.statusText);
      resolveState(await res.json());
    });
  }

  async readFile(filename) {
    const [type, one] = filename.split("/");
    if (type == "files") {
      const { data, mime } = this.sql.exec(`SELECT data, mime FROM files WHERE id = ?`, one).next().value;
      return new Blob([data], { type: mime });
    } else if (type == "events") {
      const [[startTime, startId], [endTime, endId]] = one.split(".")[0].split("-").map(s => s.split("_"));
      if (!startTime || !startId || !endTime || !endId)
        throw new Error("Events filename file is corrupted: " + filename);
      const res = this.sql.exec(`SELECT * FROM events WHERE id BETWEEN ? AND ? ORDER BY id ASC`, startId, endId).toArray();
      if (res[0].timestamp != startTime || res[res.length - 1].timestamp != endTime)
        throw new Error("Events filename doesn't match do reality: " + filename);
      for (const r of res)
        r.json = JSON.parse(r.json);
      return new Blob([JSON.stringify(res)], { type: "application/json" });
    } else if (type == "snap.json") {
      const currentState = await this.#currentState;
      return new Blob([JSON.stringify(currentState.snap)], { type: "application/json" });
    }
    throw new Error("Unknown file: " + filename);
  }

  addFile(email, { filename, contentType, data }) {
    const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    this.sql.exec(`INSERT INTO files (id, email, name, mime, data) VALUES (?, ?, ?, ?, ?)`, key, email, filename, contentType, data);
    return key;
  }

  getEventFileName() {
    const eA = this.sql.exec(`SELECT * FROM events ORDER BY id ASC LIMIT 1`).next().value;
    if (!eA) return;
    const eZ = this.sql.exec(`SELECT * FROM events ORDER BY id DESC LIMIT 1`).next().value;
    return `${eA.timestamp}_${eA.id}-${eZ.timestamp}_${eZ.id}`;
  }

  syncStart() {
    const res = this.sql.exec(`SELECT name FROM files ORDER BY id DESC`).toArray();
    const eventFile = this.getEventFileName();
    if (eventFile)
      res.push(eventFile + ".json.gz");
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
          throw new Error("Events filename file is corrupted: " + filename);
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
    const currentState = await this.#currentState;
    const newState = {
      lastEventId: this.sql.exec("SELECT * FROM events ORDER BY id DESC LIMIT 1").next().value?.id,
      snap: ObjectAssignAssign(currentState.snap, json),
      pages: currentState.pages,
    };
    return this.#currentState = newState;
  }

  async getSnap(name, cb) {
    const currentState = await this.#currentState;
    if (!name) return currentState.snap;
    if (!cb) throw new Error("You must provide a callback to process the snap in order to get a custom snap.");
    return (currentState.snaps ??= {})[name] ??= cb(currentState.snap);
  }
}