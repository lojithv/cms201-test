import { DurableObject } from "cloudflare:workers";
import { ResendEmail } from "./resendEmail.js";
import { AesGcmHelper } from "./AesGcmHelper.js";

export class EventsSnaps extends DurableObject {

  constructor(ctx, env) {
    super(ctx, env);
    this.resend = new ResendEmail(env.RESEND);
    this.sql = this.ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER DEFAULT (strftime('%s','now')),
        email TEXT,
        json TEXT
      );
      CREATE TABLE IF NOT EXISTS snaps (
        name TEXT PRIMARY KEY,
        value TEXT,
        eventId INTEGER,
        timestamp INTEGER DEFAULT (strftime('%s','now'))
      );
    `);
  }

  #aes;
  async getAes() {
    return this.#aes ??= await AesGcmHelper.make("hello sunshine");
  }

  getEvents(id = -1) {
    const res = this.sql.exec(`SELECT * FROM events WHERE id > ? ORDER BY id ASC`, id).toArray();
    for (const r of res)
      r.json = JSON.parse(r.json);
    return res;
  }

  getLastEventId() {
    return this.sql.exec("SELECT * FROM events ORDER BY id DESC LIMIT 1").next().value?.id;
  }

  getSnap(name) {
    name ||= "all"
    const res = this.sql.exec(`SELECT * FROM snaps WHERE name = ?`, name).next().value;
    if (res) res.value = JSON.parse(res.value);
    return res;
  }

  addEvent(email, json) {
    this.sql.exec(`INSERT INTO events (email, json) VALUES (?, ?)`, email, JSON.stringify(json));
    return this.updateSnap();
  }

  //todo upsertSnap should JSON.stringify(value) for us
  upsertSnap(name, value, eventId) {
    value = JSON.stringify(value);
    this.sql.exec(`
      INSERT INTO snaps (name, value, eventId) VALUES (?, ?, ?) 
      ON CONFLICT(name) 
      DO UPDATE SET value = ?, eventId = ?, timestamp = strftime('%s','now')
    `, name, value, eventId, value, eventId);
  }

  static updateSnap(snap, events) {
    for (const { timestamp, email, json } of events) {
      const o = Object.assign(snap[json.uid] ??= { email: [], created: timestamp }, json);
      o.updated = timestamp;
      if (!o.email.includes(email))
        o.email.push(email);
    }
    return snap;
  }

  updateSnap(name = "all") {
    const prevSnap = this.getSnap(name) ?? { value: {}, eventId: -1 };
    const newLastEventId = this.getLastEventId();
    if (prevSnap.eventId === newLastEventId)
      return;
    const events = this.getEvents(prevSnap.eventId);
    const nextSnap = EventsSnaps.updateSnap(prevSnap.value, events);
    this.upsertSnap(name, nextSnap, newLastEventId);
    return nextSnap;
  }

  // clear() {
  // 	this.sql.exec(`DELETE FROM events`);
  // }

  static validateEvents(events) {
    if (!events) throw "empty events";
    for (let e of events)
      if (e.id == null || e.timestamp == null || e.email == null || e.json == null)
        throw "invalid event: " + JSON.stringify(e);
  }

  async requestRollback(newEvents, host, settings) {
    EventsSnaps.validateEvents(newEvents);
    const { domain, backup: { emails } } = settings;
    const lastId = this.getLastEventId();
    const data = {
      random: Math.random(),
      timestamp: Date.now(),
      lastId
    };
    const dataWithEvents = Object.assign({ newEvents }, data);
    this.upsertSnap("rollback", dataWithEvents, lastId);
    const aes = await this.getAes();
    const encrypted = await aes.encryptAsJSON(data);
    const link = host + "/api/confirmRollback?id=" + encodeURIComponent(encrypted);
    await this.resend.confirmRollbackEmail(domain, emails, link, JSON.stringify(this.getEvents()));
    this.upsertSnap("full", 1, lastId);
  }

  async confirmRollback(string, host, settings) {
    const { domain, backup: { emails } } = settings;
    function checkIfValid({ random, timestamp, lastId }, snap) {
      if (!snap)
        throw "no rollback snap, already rolled back.";
      if (random != snap.random && timestamp != snap.timestamp && lastId != snap.lastId)
        throw "the code we got was overwritten?";
      if ((Date.now() - Number(timestamp)) > 300000)
        throw "the code is older than 5 minutes";
      return snap;
    }
    const aes = await this.getAes();
    const decrypt = await aes.decryptAsJSON(string);
    const rollbackSnap = checkIfValid(decrypt, this.getSnap("rollback")?.value);
    const addedEvents = this.getEvents(rollbackSnap.lastId);
    await this.resend.backupEmail(domain, emails, JSON.stringify(addedEvents), "rollback");
    this.rebuild([...rollbackSnap.newEvents, ...addedEvents]);
  }

  async backup(settings) {
    const { domain, backup: { full, partial, emails } } = settings;
    const newestEventId = this.getLastEventId();
    const lastFullBackup = this.getSnap("full");
    const fullDuration = Date.now() - (lastFullBackup?.timestamp ?? 0);
    const unsafeEventCount = newestEventId - (lastFullBackup?.eventId ?? 0);

    if (fullDuration > full.time || unsafeEventCount > full.events) {
      await this.resend.backupEmail(domain, emails, JSON.stringify(this.getEvents()), "full");
      return this.upsertSnap("full", 1, newestEventId);
    }

    const lastPartialBackup = this.getSnap("partial");
    const partialDuration = Date.now() - (lastPartialBackup?.timestamp ?? 0);
    if (partialDuration > partial.time && unsafeEventCount > partial.events) {
      await this.resend.backupEmail(domain, emails, JSON.stringify(this.getEvents(lastFullBackup?.eventId)), "partial");
      return this.upsertSnap("partial", 1, newestEventId);
    }
  }

  rebuild(events) {
    this.sql.exec(`DELETE FROM snaps`);
    this.sql.exec(`DELETE FROM events`);
    for (const { id, timestamp, email, json } of events)
      this.sql.exec(
        `INSERT INTO events (id,timestamp,email,json) VALUES (?,?,?,?)`,
        id, timestamp, email, JSON.stringify(json)
      );
    this.updateSnap();
  }
}
