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
console.log("1.", input.txt);
const pages = await readDirectory('data/events');
console.log("2.", JSON.stringify(pages));

const ops = {};

if (input.size < 10_000_000) {
  const lastFileName = pages[pages.length - 1] + ".json";
  const lastFile = await readLastFile('data/events/' + lastFileName);
  console.log("3.", lastFile.txt);
  if ((lastFile.size + input.size) < 10_000_000) {
    input.events = [...lastFile.events, ...input.events];
    input.txt = JSON.stringify(input.events);
    input.size += lastFile.size;
    ops['data/events/' + lastFileName] = null;
    ops['data/snaps/' + lastFileName] = null;
    pages.pop();
    console.log("4. merged with last file");
    console.log("5.", input.txt);
    console.log("6.", JSON.stringify(pages));
  }
}
const timestampName = createXKXYKY(input.events);
pages.push(timestampName);
const snapWithNull = ObjectAssignAssign(input.events);
console.log("7.", JSON.stringify(pages), JSON.stringify(snapWithNull));
const snapOld = JSON.parse(await Deno.readTextFile('data/snap.json'));
console.log("8.", JSON.stringify(snapOld));
const snap = ObjectAssignAssign([snapOld, snapWithNull]);
console.log("9.", JSON.stringify(snap));

ops['data/events/' + timestampName + ".json"] = input.txt;
ops['data/snaps/' + timestampName + ".json"] = JSON.stringify(snapWithNull);
ops['data/pages.json'] = JSON.stringify(pages);
ops['data/snap.json'] = JSON.stringify(snap);

await Promise.all(Object.entries(ops).map(([path, data]) =>
  data ? Deno.writeTextFile(path, data) : Deno.remove(path)));
console.log("10. wrote files");
const followThrough = await fetch(`${origin}/api/cleanUpEventsAndSnap/${lastEventId}`, {
  headers: {
    method: 'POST',
    'Authorization': `Bearer ${secret}`,
    'Content-Type': 'application/json'
  },
  body: ops['/data/snap.json']
});

const endResult = followThrough.ok ? "ok" : `error: ${await followThrough.text()}`;
console.log("11.", endResult);