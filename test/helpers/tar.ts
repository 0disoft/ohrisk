import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export function createTarGz(files: Record<string, string>): Buffer {
  return gzipSync(createTar(files));
}

export function createTar(files: Record<string, string>): Buffer {
  return createTarEntries(
    Object.entries(files).map(([path, content]) => ({ path, content, type: "0" }))
  );
}

export function createTarEntries(entries: readonly {
  path: string;
  content?: string | Buffer | Uint8Array;
  type?: string;
  linkPath?: string;
}[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.content === undefined
      ? Buffer.alloc(0)
      : typeof entry.content === "string"
        ? Buffer.from(entry.content, "utf8")
        : Buffer.from(entry.content);
    chunks.push(
      createTarHeader(entry.path, data.byteLength, entry.type ?? "0", entry.linkPath),
      data,
      Buffer.alloc(Math.ceil(data.byteLength / 512) * 512 - data.byteLength)
    );
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function integrityFor(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function createTarHeader(filePath: string, size: number, type: string, linkPath?: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(filePath, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write(type, 156, 1, "ascii");
  if (linkPath) {
    header.write(linkPath, 157, 100, "utf8");
  }
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}
