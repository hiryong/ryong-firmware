// Read one file out of a (small, non-zip64) zip in a Worker. GitHub serves build artifacts as a zip;
// browsers flag that zip as "dangerous", so the admin page hands out the UF2 / Bluetooth package itself.
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export type ZipEntry = { name: string; method: number; compressed: number; size: number; offset: number };

export function listZip(zip: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip");
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(zip, p) !== 0x02014b50) throw new Error("bad zip directory");
    const nameLen = u16(zip, p + 28), extraLen = u16(zip, p + 30), commentLen = u16(zip, p + 32);
    out.push({ name: new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)), method: u16(zip, p + 10),
      compressed: u32(zip, p + 20), size: u32(zip, p + 24), offset: u32(zip, p + 42) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function readZipEntry(zip: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (u32(zip, e.offset) !== 0x04034b50) throw new Error("bad zip entry");
  const start = e.offset + 30 + u16(zip, e.offset + 26) + u16(zip, e.offset + 28);
  const data = zip.subarray(start, start + e.compressed);
  if (e.method === 0) return data.slice();
  if (e.method !== 8) throw new Error("unsupported zip compression");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  // Read with a cap: never expand past the size the directory announced.
  const reader = stream.getReader();
  const out = new Uint8Array(e.size);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > e.size) { await reader.cancel(); throw new Error("zip entry larger than announced"); }
    out.set(value, n); n += value.length;
  }
  if (n !== e.size) throw new Error("zip entry size mismatch");
  return out;
}
