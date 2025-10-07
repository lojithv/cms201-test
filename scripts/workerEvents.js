function ObjectAssignAssign(objs) {
  objs = objs.map(o => o.json);
  const res = {};
  for (let obj of objs)
    for (let key in obj)
      Object.assign(res[key] ?? {}, obj[key]);
  return res;
}

async function readDirectoryWithoutJson(path) {
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

async function main(origin, lastEventId, secret) {
  const input = await readInput(`${origin}/api/eventsOlderThan/${lastEventId}`, secret);
  console.log("1.", input.txt);
  if (!input.events.length)
    return console.log("no new events, ending.");

  const oldSnap = await Deno.readTextFile('data/snap.json');
  console.log("2.", JSON.stringify(oldSnap));
  const pages = await readDirectoryWithoutJson('data/events');
  console.log("3.", JSON.stringify(pages));

  const ops = {};

  if (input.size < 10_000_000) {
    const lastFileName = pages[pages.length - 1];
    const lastFile = await readLastFile('data/events/' + lastFileName);
    console.log("4.", lastFile.txt);
    if ((lastFile.size + input.size) < 10_000_000) {
      input.events = [...lastFile.events, ...input.events];
      input.txt = JSON.stringify(input.events);
      input.size += lastFile.size;
      ops['data/events/' + lastFileName] = null;
      pages.pop();
      console.log("5.", "new merged", input.txt);
      console.log("6.", JSON.stringify(pages));
    }
  }
  const { timestamp: x, id: kx } = events[0];
  const { timestamp: y, id: ky } = events[events.length - 1];
  const timestampName = `${x}_${kx}_${y}_${ky}`;
  pages.push(timestampName);

  const oldSnapObj = JSON.parse(oldSnap);
  const newSnapObj = ObjectAssignAssign([oldSnapObj, ...input.events]);
  const newSnap = {
    lastEventId,
    snap: newSnapObj,
    pages: pages
  };
  console.log("7.", JSON.stringify(newSnap));
  ops['data/events/' + timestampName + '.json'] = input.txt;
  ops['public/snap.json'] = JSON.stringify(newSnap);

  await Deno.mkdir("data/events", { recursive: true });
  await Promise.all(Object.entries(ops).map(([path, data]) =>
    data ? Deno.writeTextFile(path, data) : Deno.remove(path)));
  console.log("10. wrote files", origin, lastEventId);
}

main(...Deno.args);