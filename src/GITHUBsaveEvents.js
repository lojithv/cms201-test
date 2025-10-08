import { ObjectAssignAssign } from "./utils.js";

async function readInput(url, secret) {
  const txt = await (await fetch(url, { headers: { 'Authorization': `Bearer ${secret}` } })).text();
  const size = new TextEncoder().encode(txt).length;
  const events = JSON.parse(txt);
  return { events, size, txt };
}

async function getLastGzipFileName(directory) {
  const directory = await Deno.readDir(directory);
  let lastFileName;
  for await (const unit of directory)
    if (unit.isFile && unit.name.endsWith('.gz'))
      if (!lastFileName || unit.name > lastFileName.name)
        lastFileName = unit.name;
  return directory + lastFileName;
}

async function readLastFile(directory) {
  const lastFileName = await getLastGzipFileName(directory);
  //todo this should be a zip file, and so upack it.

  const txt = await Deno.readTextFile(path);
  const size = new TextEncoder().encode(txt).length;
  const events = JSON.parse(txt);
  return { events, size, txt };
}

async function main(origin, lastEventId, secret) {
  const input = await readInput(`${origin}/api/events`, secret);
  console.log("1.", input.txt);
  if (!input.events.length)
    return console.log("no new events, ending.");

  const serverState = JSON.parse(await Deno.readTextFile('public/data/state.json'));
  console.log("2.", JSON.stringify(serverState));

  const ops = {};

  if (input.size < 10_000_000) {
    const lastFileName = serverState.pages.at(-1) + '.json';
    const lastFile = await readLastFile('public/data/events/');
    console.log("4.", lastFile.txt);
    if ((lastFile.size + input.size) < 10_000_000) {
      input.events = [...lastFile.events, ...input.events];
      input.txt = JSON.stringify(input.events);
      input.size += lastFile.size;
      ops['public/data/events/' + lastFileName] = null;
      pages.pop();
      console.log("5.", "new merged", input.txt);
      console.log("6.", JSON.stringify(pages));
    }
  }
  const { timestamp: x, id: kx } = input.events[0];
  const { timestamp: y, id: ky } = input.events.at(-1);
  const timestampName = `${x}_${kx}_${y}_${ky}`;
  pages.push(timestampName);

  const newState = {
    lastEventId,
    snap: ObjectAssignAssign([serverState.snap, ...input.events.map(e => e.json)]),
    pages
  };
  console.log("7.", JSON.stringify(newState));
  ops['public/data/events/' + timestampName + '.json'] = input.txt;
  ops['public/state.json'] = JSON.stringify(newState);

  await Deno.mkdir("data/events", { recursive: true });
  await Promise.all(Object.entries(ops).map(([path, data]) =>
    data ? Deno.writeTextFile(path, data) : Deno.remove(path)));
  console.log("10. wrote files", origin, lastEventId);
}

main(...Deno.args);