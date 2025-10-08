import { ObjectAssignAssign, gunzipToString, gzipString } from "./utils.js";

async function readInput(url, secret) {
  const txt = await (await fetch(url, { headers: { 'Authorization': `Bearer ${secret}` } })).text();
  const size = new TextEncoder().encode(txt).length;
  const events = JSON.parse(txt);
  return { events, size, txt };
}

async function readLastFile(directory) {
  const directory = await Deno.readDir(directory);
  let mostUptodateFile;
  for await (const unit of directory)
    if (unit.isFile && unit.name.endsWith('.gz'))
      if (!mostUptodateFile || unit.name > mostUptodateFile.name)
        mostUptodateFile = unit;
  const filename = directory + mostUptodateFile.name;
  const gzipFileContent = await Deno.readFile(filename);
  const txt = await gunzipToString(gzipFileContent);
  return {
    filename,
    events: JSON.parse(txt),
    size: mostUptodateFile.size,
    txt
  };
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
    const lastFile = await readLastFile('public/data/events/');
    console.log("4.", lastFile.txt);
    if ((lastFile.size + input.size) < 10_000_000) {
      input.events = [...lastFile.events, ...input.events];
      input.txt = JSON.stringify(input.events);
      input.size += lastFile.size;
      ops['public/data/events/' + lastFile.filename] = null;
      pages.pop();
      console.log("5.", "new merged", input.txt);
      console.log("6.", JSON.stringify(pages));
    }
  }
  const timestampName = `${input.events[0].timestamp}_${input.events.at(-1).timestamp}`;
  input.filename = 'public/data/events/' + timestampName + '.json.gz';
  input.gzip = await gzipString(input.txt);
  pages.push(timestampName);

  const newState = {
    lastEventId,
    snap: ObjectAssignAssign([serverState.snap, ...input.events.map(e => e.json)]),
    pages
  };
  console.log("7.", JSON.stringify(newState));
  
  ops[input.filename] = input.gzip;
  ops['public/state.json'] = JSON.stringify(newState);

  await Deno.mkdir("data/events", { recursive: true });
  await Promise.all(Object.entries(ops).map(([path, data]) =>
    data ? Deno.writeTextFile(path, data) : Deno.remove(path)));
  console.log("10. wrote files", origin, lastEventId);
}

main(...Deno.args);