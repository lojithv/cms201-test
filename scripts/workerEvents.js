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

async function readDirectory(path) {
  const pages = [];
  for await (const entry of Deno.readDir(path))
    if (entry.isFile && entry.name.endsWith('.json'))
      pages.push(entry.name.slice(0, -5));
  pages.sort();
  return pages;
}

async function readInput(url, secret) {
  const txt = await (await fetch(url, { headers: { 'Authorization': `Bearer ${secret}` } })).text();
  const size = new TextEncoder().encode(txt).length;
  const events = JSON.parse(txt);
  return { events, size, txt };
}

async function readLastFile(path) {
  const txt = await Deno.readTextFile(path);
  const size = new TextEncoder().encode(txt).length;
  const events = JSON.parse(txt);
  return { events, size, txt };
}

// await Deno.mkdir("data/events", { recursive: true });
// await Deno.mkdir("data/snaps", { recursive: true });

const [origin, lastEventId, secret] = Deno.args;
const input = await readInput(`${origin}/api/eventsOlderThan/${lastEventId}`, secret);
const pages = await readDirectory('data/events');

const ops = {};

if (input.size < 10_000_000) {
  const lastFileName = pages[pages.length - 1] + ".json";
  const lastFile = await readLastFile('data/events/' + lastFileName);
  if ((lastFile.size + input.size) < 10_000_000) {
    input.events = [...lastFile.events, ...input.events];
    input.txt = JSON.stringify(input.events);
    input.size += lastFile.size;
    ops['/data/events/' + lastFileName] = null;
    ops['/data/snaps/' + lastFileName] = null;
    pages.pop();
  }
}
const timestampName = createXKXYKY(input.events);
const snapWithNull = ObjectAssignAssign(input.events);
const snapOld = JSON.parse(await Deno.readTextFile('/data/snap.json'));
const snap = ObjectAssignAssign([snapOld, snapWithNull]);
pages.push(timestampName);

ops['/data/events/' + timestampName] = input.txt;
ops['/data/snaps/' + timestampName] = JSON.stringify(snapWithNull);
ops['/data/pages.json'] = JSON.stringify(pages);
ops['/data/snap.json'] = JSON.stringify(snap);

await Promise.all(Object.entries(ops).map(([path, data]) =>
  data ? Deno.writeTextFile(path, data) : Deno.remove(path)));

const followThrough = await fetch(`${origin}/api/cleanUpEventsAndSnap/${lastEventId}`, {
  headers: {
    method: 'POST',
    'Authorization': `Bearer ${secret}`,
    'Content-Type': 'application/json'
  },
  body: ops['/data/snap.json']
});
