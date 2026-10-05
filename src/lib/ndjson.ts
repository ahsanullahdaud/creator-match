const encoder = new TextEncoder();

/**
 * Streams one JSON object per line. Lines go out as the iterable yields them,
 * so a slow batch does not hold back the ones already finished.
 */
export function ndjsonResponse(
  lines: AsyncIterable<unknown>,
  init: ResponseInit = {},
): Response {
  const iterator = lines[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/x-ndjson; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-accel-buffering", "no");
  return new Response(stream, { ...init, headers });
}

/**
 * Reads an NDJSON body line by line, calling onLine for each parsed object
 * as soon as its newline arrives. Returns the number of lines read.
 */
export async function readNdjson<T>(
  response: Response,
  onLine: (line: T) => void,
): Promise<number> {
  let count = 0;
  const emit = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    onLine(JSON.parse(line) as T);
    count += 1;
  };

  if (!response.body) {
    for (const raw of (await response.text()).split("\n")) emit(raw);
    return count;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      emit(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  emit(buffer);
  return count;
}
