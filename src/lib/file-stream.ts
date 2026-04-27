import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

async function writeReadableStreamToPath(stream: ReadableStream<Uint8Array>, filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  await pipeline(Readable.fromWeb(stream as any), createWriteStream(filePath));
}

export async function writeUploadedFileToPath(file: File, filePath: string) {
  if (typeof file.stream === "function") {
    await writeReadableStreamToPath(file.stream(), filePath);
    return;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  mkdirSync(dirname(filePath), { recursive: true });
  await pipeline(Readable.from(bytes), createWriteStream(filePath));
}

export async function writeFetchResponseToPath(response: Response, filePath: string) {
  if (response.body) {
    await writeReadableStreamToPath(response.body, filePath);
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(filePath), { recursive: true });
  await pipeline(Readable.from(bytes), createWriteStream(filePath));
}
