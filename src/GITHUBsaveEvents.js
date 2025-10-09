import { ObjectAssignAssign, gunzipToString, gzipString } from "./tools.js";

async function readInput(url, secret) {
  const txt = await (await fetch(url, { headers: { 'Authorization': `Bearer ${secret}` } })).text();
  const size = new TextEncoder().encode(txt).length;
  const events = JSON.parse(txt);
  return { events, size, txt };
}

async function readPages(directory) {
  const pages = [];
  for await (const { isFile, name } of await Deno.readDir(directory))
    if (isFile && name.endsWith('.json.gz'))
      pages.push(name.split(".")[0]);
  pages.sort();
  return pages;
}

async function readLastFile(filename) {
  const gzipFileContent = await Deno.readFile(filename);
  const txt = await gunzipToString(gzipFileContent);
  const events = JSON.parse(txt);
  const size = mostUptodateFile.size;
  return { filename, events, size, txt };
}

function mergeJsonEventFiles(one, two) {
  const events = [...two.events, ...one.events];
  const txt = JSON.stringify(events);
  const size = one.size + two.size;
  return { events, txt, size };
}

async function main(origin, secret) {
  let input;
  try {
    input = await readInput(origin + "/api/events", secret);
    const lastEvent = input.events.at(-1);
    console.log("1. read input with events count: " + input.events.length);
    if (!input.events.length)
      return console.log("X. no new events.");

    serverState = JSON.parse(await Deno.readTextFile('public/data/state.json'));
    console.log("2. read server state.");
    const pages = await readPages('public/data/events/');
    console.log("3. read pages.");

    const ops = {};
    if (input.size < 10_000_000) {
      lastFile = await readLastFile('public/data/events/' + pages.at(-1) + ".json.gz");
      console.log("4. read lastFile");
      if ((lastFile.size + output.size) < 10_000_000) {
        output = mergeJsonEventFiles(input, lastFile);
        console.log("5. merged events with lastFile");
        ops['public/data/events/' + lastFile.filename] = null;
        pages.pop();
      }
    }
    output ??= { ...input };
    const timestampName = `${output.events[0].timestamp}_${output.events.at(-1).timestamp}`;
    pages.push(timestampName);
    newState = {
      lastEvent,
      snap: ObjectAssignAssign([serverState.snap, ...output.events.map(e => e.json)]),
      pages
    };
    ops['public/state.json'] = JSON.stringify(newState);
    console.log("6. prepared new state.json.");

    const newFilename = 'public/data/events/' + timestampName + '.json.gz';
    ops[newFilename] = await gzipString(output.txt);
    console.log("7. prepared " + newFilename);

    await Deno.mkdir("data/events", { recursive: true });
    await Promise.all(Object.entries(ops).map(([path, data]) =>
      data ? Deno.writeTextFile(path, data) : Deno.remove(path)));
    console.log("8. wrote files", origin);
  } catch (err) {
    if (input)
      Deno.writeTextFile('data_invalid/' + new Date().getTime() + ".json", input.txt);
  }
}

main(...Deno.args);