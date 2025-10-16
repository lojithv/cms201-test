import { ObjectAssignAssign, gunzipToString, gzipString } from "./tools.js";

async function readInput(url, secret) {
  const txt = await (await fetch(url, { headers: { 'Authorization': `Bearer ${secret}` } })).text();
  const size = new TextEncoder().encode(txt).length;
  const events = JSON.parse(txt);
  return { events, size, txt };
}

async function readPagesNewestFirst(directory) {
  const pages = [];
  for await (const { isFile, name } of await Deno.readDir(directory))
    if (isFile && name.endsWith('.json.gz'))
      pages.push(name);
  files.sort().reverse();
  return pages;
}

async function readRecentFile(filename) {
  const gzipFileContent = await Deno.readFile(filename);
  const txt = await gunzipToString(gzipFileContent);
  const events = JSON.parse(txt);
  const size = gzipFileContent.length;
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
    input = await readInput(origin + "/api/github/events", secret);
    console.log("1. read input with events count: " + input.events.length);
    if (!input.events.length)
      return console.log("X. no new events.");

    const serverState = JSON.parse(await Deno.readTextFile('public/data/state.json'));
    console.log("2. read server state.");
    const pages = await readPagesNewestFirst('public/data/events/');
    console.log("3. read pages.");

    let output;
    const ops = {};
    if (input.size < 4_000_000) {  //4mb gzip => 25mb json?? hopefully it wont break if we unpack in the worker.
      const lastFile = await readRecentFile('public/data/events/' + pages[0]);
      console.log("4. read lastFile");
      if ((lastFile.size + input.size) < 4_000_000) {
        output = mergeJsonEventFiles(input, lastFile);
        console.log("5. merged events with lastFile");
        ops['public/data/events/' + lastFile.filename] = null;
        pages.shift();
      }
    }
    output ??= { ...input };
    const first = output.events[0];
    const last = output.events.at(-1).timestamp;
    //TODO fix this new name in the codebase
    const newFilename = `${first.timestamp}_${first.id}-${last.timestamp}_${last.id}.json.gz`;
    pages.unshift(newFilename);
    const snap = ObjectAssignAssign([serverState.snap, ...output.events.map(e => e.json)])
    const newState = {
      firstSavedEvent: { id: input.events[0].id, timestamp: input.events[0].timestamp},
      snap,
      pages: pages.map(p => p.split(".")[0]), //strip .json.gz
    };
    ops['public/data/state.json'] = JSON.stringify(newState);
    console.log("6. prepared new state.json.");

    ops['public/data/events/' + newFilename] = await gzipString(output.txt);
    console.log("7. prepared " + newFilename);

    await Deno.mkdir("data/events", { recursive: true });
    await Promise.all(Object.entries(ops).map(([path, data]) =>
      data ? Deno.writeTextFile(path, data) : Deno.remove(path)));
    console.log("8. wrote files", origin);
  } catch (err) {
    console.error("E. failed to read input", err.message);
    if (!input)
      return console.error("E. failed to read input", err.message);
    await Deno.mkdir("data_invalid/", { recursive: true });
    Deno.writeTextFile('data_invalid/' + new Date().getTime() + ".json", input.txt);
  }
}

main(...Deno.args);