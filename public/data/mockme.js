const snapJSON = JSON.parse(await Deno.readTextFile("./tegntv_data3.json"));
const eventList = [];

let i = 0;
for (let id in snapJSON) {
    const snap1 = snapJSON[id];
    const snap2 = Object.assign({}, snap1);
    for (const key of Object.keys(snap1).slice(3))
        delete snap1[key];
    for (const key of Object.keys(snap1))
        delete snap2[key];
    const key3 = Object.keys(snap1)[2];
    snap2[key3] = snap1[key3];
    snap1[key3] = "hello sunshine";
    snap1.uid = id;
    snap2.uid = id;
    const timestamp1 = 327054752000 + i * 24 * 3600000;
    const timestamp2 = 327054752000 + (i + 180) * 24 * 3600000;
    eventList.push(
        { id: i++, timestamp: timestamp1, json: snap1 },
        { id: i++, timestamp: timestamp2, json: snap2 }
    );
}

// Write output to file
await Deno.writeTextFile("./tegntv_data4.json", JSON.stringify(eventList, null, 2));
