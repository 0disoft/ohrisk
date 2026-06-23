import { gzipSync } from "node:zlib";

export function createTarGz(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];

  for (const [filePath, text] of Object.entries(files)) {
    const pathBuffer = Buffer.from(filePath, "utf8");
    const data = Buffer.from(text, "utf8");
    const header = Buffer.alloc(512);

    pathBuffer.copy(header, 0, 0, Math.min(pathBuffer.length, 100));
    header.write("0000777\0", 100, "ascii");
    header.write("0000000\0", 108, "ascii");
    header.write("0000000\0", 116, "ascii");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
    header.write("00000000000\0", 136, "ascii");
    header.fill(" ", 148, 156);
    header.write("0", 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    header.write("00", 263, "ascii");

    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");

    parts.push(header, data, Buffer.alloc(roundUpToBlock(data.length) - data.length));
  }

  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

function roundUpToBlock(size: number): number {
  return Math.ceil(size / 512) * 512;
}
