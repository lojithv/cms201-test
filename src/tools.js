// gzip a UTF-8 string → Uint8Array (.gz bytes)
export async function gzipString(input) {
  const bytes = new TextEncoder().encode(input);
  const cs = new CompressionStream("gzip");
  const ab = await new Response(
    new Blob([bytes]).stream().pipeThrough(cs)
  ).arrayBuffer();
  return new Uint8Array(ab);
}

// gunzip Uint8Array (.gz bytes) → UTF-8 string
export async function gunzipToString(gzipBytes) {
  const ds = new DecompressionStream("gzip");
  const ab = await new Response(
    new Blob([gzipBytes]).stream().pipeThrough(ds)
  ).arrayBuffer();
  return new TextDecoder().decode(ab);
}

// ObjectAssignAssign({alice: {}, bob: {one: 1, two: 2}}, {bob: {two: 4}})
// => { alice: {}, bob: {one: 1, two: 4} } // note that the bob.one was left intact
export function ObjectAssignAssign(...objs) {
  const res = {};
  for (const obj of objs)
    for (const [key, obj2] of Object.entries(obj))
      for (let [key2, value] of Object.entries(obj2))
        (res[key] ??= {})[key2] = value;
  return res;
}

