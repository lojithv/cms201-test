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

