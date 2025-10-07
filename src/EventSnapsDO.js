import { DurableObject } from "cloudflare:workers";

// ObjectAssignAssign({alice: {}, bob: {one: 1, two: 2}}, {bob: {two: 4}})
// => { alice: {}, bob: {one: 1, two: 4} } // note that the bob.one was left intact
function ObjectAssignAssign(...objs) {
  const result = {};
  for (const obj of objs)
    for (const [key, value] of Object.entries(obj)) {
      result[key] ??= {};
      for (const innerKey of value)
        result[key][innerKey] = Object.assign(result[key][innerKey] ?? {}, obj[key]);
    }
  return result;
}

export class EventsSnaps extends DurableObject {

  #startState;
  #currentState;

  constructor(ctx, env) {
    super(ctx, env);
    this.sql = this.ctx.storage.sql;
    this.sql.exec(`
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER DEFAULT (strftime('%s','now')),
  email TEXT,
  json TEXT
);`);
    ctx.blockConcurrencyWhile(_ => this.initialize(env));
  }

  async initialize(env) {
    const startState = await (await env.ASSETS.fetch("data/state.json")).json();
    if (this.#startState?.lastEventId >= startState.lastEventId)
      return;
    this.#startState = this.#currentState = startState;
    this.sql.exec(`DELETE FROM events WHERE id <= ?`, startState.lastEventId); //todo unsafe
    const events = this.getEvents();
    ObjectAssignAssign(this.#currentState.snap, ...events.map(e => e.json));
    this.#currentState.lastEventId = events.at(-1).id;

    //todo make unsafe safer
    //todo how can we make this safer? I am worried about problems with the id being lower or something
    //todo should we use both timestamp and id? 
    //If we then get some events with the same event id, but different timestamp, we have an error point.
    //we might also like to check all the events. That will be waaay slower. Nah.. Github must be the source of truth.
    //how do we check that the event is stored in github. We would then need to check the last page on github and verify one by one.
  }

  addEvent(email, json) {
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(email))
      throw "invalid email: " + email;
    this.sql.exec(`INSERT INTO events (email, json) VALUES (?, ?)`, email, JSON.stringify(json));
    const newState = {
      lastEventId: this.sql.exec("SELECT * FROM events ORDER BY id DESC LIMIT 1").next().value?.id,
      snap: ObjectAssignAssign(this.#currentState.snap, json),
      pages: this.#currentState.pages,
    };
    return this.#currentState = newState;
  }

  getEvents() {
    const res = this.sql.exec(`SELECT * FROM events`).toArray();
    for (const r of res)
      r.json = JSON.parse(r.json);
    return res;
  }

  getSnap(name, cb) {
    if (!name) return this.#currentState.snap;
    if (!cb) throw new Error("You must provide a callback to process the snap in order to get a custom snap.");
    return (this.#currentState.snaps ??= {})[name] ??= cb(this.#currentState.snap);
  }
}