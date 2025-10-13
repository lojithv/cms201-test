import { DurableObject } from "cloudflare:workers";
import { ObjectAssignAssign, gunzipToString } from "./tools.js";

export class EventsSnaps extends DurableObject {

  #startState;
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
);`);
    // ctx.blockConcurrencyWhile(async () => await this.init());
  }

  // async getUnzippedEventsAfter(page, startTime, startId) {
  //   const res = await this.env.ASSETS.fetch(new URL(`/data/events/${page}`, "https://assets.local"));
  //   if (!res.ok)
  //     throw new Error(`ASSETS fetch failed: ${res.status}`);
  //   const text = await gunzipToString(await res.arrayBuffer());
  //   return JSON.parse(text).filter(e => e.timestamp >= startTime && e.id >= startId);
  // }

  // async deleteEvents(pages, { timestamp, id }) {
  //   const eventsAfter = await this.getUnzippedEventsAfter(pages[0], timestamp, id);

  //   const [endTimestamp, endId] = endEvent.split("_").pop().split("-");
  //   //todo these events must match the start of our events in the DO.

  //   //todo add the id too, then we should be safe.
  //   const doEvents = this.sql.exec(`SELECT * FROM events WHERE timestamp <= ? AND id <= ? ASC`, timestamp, id).toArray();
  //   if (!doEvents.length)
  //     return [];
  //   const zippedEvents = await this.getUnzippedEventsAfter(pages, doEvents[0].timestamp, timestamp);
  //   //todo here, we can make a string with the email

  //   //todo now, we need to get the list of all the events that we have in the DO that we can delete.
  //   //the events are saved in the zipfile in public/data/events/

  // }

  // async loadStartState() {
  //   const res = await this.env.ASSETS.fetch(new URL("/data/state.json", "https://assets.local"));
  //   if (!res.ok)
  //     throw new Error(`ASSETS fetch failed: ${res.status}`);
  //   const { timestamp, snap, pages } = await res.json();
  //   if (typeof timestamp !== "number" || !(snap && typeof snap === "object") || !(pages instanceof Array))
  //     throw new Error("public/data/state.json from github is malformed: {timestamp: number, snap: object, pages: array}.");
  //   if (timestamp > Date.now())
  //     throw new Error("public/data/state.json from github has a timestamp in the future.");
  //   if (timestamp < this.#startState?.timestamp)
  //     throw new Error("OMG! public/data/state.json from github is OLDER THAN #this.startState in DO.");
  //   return { timestamp, snap, pages };
  // }

  // async init() {
  //   //when we are starting.
  //   //we need to verify and validate the incoming /data/state.json
  //   //it cannot be older than our current #startState
  //   //it must be formated in the right way.
  //   //

  //   const res = await this.env.ASSETS.fetch(new URL("/data/state.json", "https://assets.local"));
  //   if (!res.ok) throw new Error(`ASSETS fetch failed: ${res.status}`); //throw 1
  //   const newStartState = await res.json();
  //   if (newStartState.timestamp == this.#startState?.timestamp)
  //     return; //up to date, no need for changes.

  //   if (newStartState.timestamp < this.#startState?.timestamp)
  //     throw new Error("OMG! public/data/state.json from github is OLDER THAN #this.startState in DO.");

  //   const shouldBeSaved = this.sql.exec(`SELECT * FROM events WHERE timestamp <= ?`, newStartState.).toArray();
  //   //todo we might have an event that has the same 
  //   const notSaved = this.sql.exec(`SELECT * FROM events WHERE timestamp > newStartState`).toArray();
  //   //We need to download the events zip from /publi
  //   //2. the lastEvents from newStartState does *not* match the head of the do events.
  //   // 1 get the events from the DO
  //   // 2 compare the head of the events with the 
  //   const doEventsHeadDoesNotMatchNewStartState =
  //     this.sql.exec(`SELECT * FROM events`).toArray().every((e, i) => {
  //       const e2 = newStartState.lastEvents[i];
  //       return e.timestamp === e2.timestamp && e.email === e2.email && e.id == e2.id;
  //     });
  //   //if we have corrupt data like this, then what do we do??

  //   for (const { id } of newStartState.lastEvents)
  //     this.sql.exec(`DELETE FROM events WHERE id == ?`, id);
  //   const events = this.getEvents();
  //   if (!events.length)
  //     return;
  //   this.#currentState = { ...this.#startState };
  //   this.#currentState.snap = ObjectAssignAssign(this.#startState.snap, ...events.map(e => e.json));
  // }

  getEvents() {
    const res = this.sql.exec(`SELECT * FROM events`).toArray();
    for (const r of res)
      r.json = JSON.parse(r.json);
    return res;
  }

  addEvent(email, json) {
    this.sql.exec(`INSERT INTO events (email, json) VALUES (?, ?)`, email, JSON.stringify(json));
    const newState = {
      lastEventId: this.sql.exec("SELECT * FROM events ORDER BY id DESC LIMIT 1").next().value?.id,
      snap: ObjectAssignAssign(this.#currentState.snap, json),
      pages: this.#currentState.pages,
    };
    return this.#currentState = newState;
  }

  getSnap(name, cb) {
    if (!name) return this.#currentState.snap;
    if (!cb) throw new Error("You must provide a callback to process the snap in order to get a custom snap.");
    return (this.#currentState.snaps ??= {})[name] ??= cb(this.#currentState.snap);
  }
}