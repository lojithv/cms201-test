function ObjectAssignAssign(objs) {
  objs = objs.map(o => o.json);
  const res = {};
  for (let obj of objs)
    for (let key in obj)
      Object.assign(res[key] ?? {}, obj[key]);
  return res;
}

function createXKXYKY(events) {
  const { timestamp: x, id: kx } = events[0];
  const { timestamp: y, id: ky } = events[events.length - 1];
  return `${x}_${kx}_${y}_${ky}.json`;
}

const ORIGIN = Deno.args[0];
const WORKER_LAST_EVENT_ID = parseInt(Deno.args[1]);
const WORKER_SECRET = Deno.args[2];
// await Deno.mkdir("data/events", { recursive: true });
// await Deno.mkdir("data/snaps", { recursive: true });

const input = await fetch(`${ORIGIN}/api/eventsOlderThan/${WORKER_LAST_EVENT_ID}`, {
  headers: {
    'Authorization': `Bearer ${WORKER_SECRET}`
  }
});
const events = await input.json();
const eventsSize = new TextEncoder().encode(JSON.stringify(events)).length;

//the latest events file, should be the last.
const pages = [];
for await (const entry of Deno.readDir('/data/events/')) {
  if (entry.isFile && entry.name.endsWith('.json'))
    pages.push(entry.name.slice(0, -5));
}
pages.sort();
const latestFile = pages[pages.length - 1];
const latestEvents = JSON.parse(await Deno.readTextFile('/data/events/' + latestFile));
const latestEventsSize = new TextEncoder().encode(JSON.stringify(latestEvents)).length;

const saveFiles = {};
const unlinkFiles = {};
let snapWithNull, timestampName;
if ((latestEventsSize + eventsSize) > 10_000_000) { //10MB max per file
  timestampName = createXKXYKY(events);
  snapWithNull = ObjectAssignAssign(events);
  saveFiles['/data/events/' + timestampName] = JSON.stringify(events);
  saveFiles['/data/snaps/' + timestampName] = JSON.stringify(snapWithNull);
} else {
  const events2 = [...latestEvents, ...events];
  timestampName = createXKXYKY(events2);
  snapWithNull = ObjectAssignAssign(events2);
  saveFiles['/data/events/' + timestampName] = JSON.stringify(events2);
  saveFiles['/data/snaps/' + timestampName] = JSON.stringify(snapWithNull);
  unlinkFiles['/data/events/' + latestFile];
  unlinkFiles['/data/snaps/' + latestFile];
  pages.pop(); //latest page is last in list
}

const latestSnap = JSON.parse(await Deno.readTextFile('/data/snaps.json'));
const newSnap = ObjectAssignAssign([latestSnap, { json: snapWithNull }]);
pages.push(timestampName);
saveFiles['/data/snaps.json'] = JSON.stringify(newSnap);
saveFiles['/data/pages.json'] = JSON.stringify(pages.map(f => f.replace('.json', '')));
await Promise.all([
  ...Object.entries(saveFiles).map(([path, data]) => Deno.writeTextFile(path, data)),
  ...Object.entries(unlinkFiles).map(([path]) => Deno.remove(path))
]);

const followThrough = await fetch(`https://${ORIGIN}/api/cleanUpEventsAndSnap/${WORKER_LAST_EVENT_ID}`, {
  headers: {
    method: 'POST',
    'Authorization': `Bearer ${WORKER_SECRET}`,
    'Content-Type': 'application/json'
  },
  body: saveFiles['/data/snaps.json']
});
