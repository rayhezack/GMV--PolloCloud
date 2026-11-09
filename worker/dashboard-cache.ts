// The platform limits a single D1 value to 64 KiB. Long card histories exceed
// that as JSON, but gzip fits comfortably without changing the public API.
export async function encodeDashboardCache(payload: string): Promise<string> {
  if (new TextEncoder().encode(payload).length < 48 * 1024) return payload;
  const bytes = new Uint8Array(await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `gzip:${btoa(binary)}`;
}

export async function decodeDashboardCache(payload: string): Promise<string> {
  if (!payload.startsWith('gzip:')) return payload;
  const bytes = Uint8Array.from(atob(payload.slice(5)), character => character.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
