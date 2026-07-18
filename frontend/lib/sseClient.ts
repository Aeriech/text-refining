// sseClient.ts
//
// A minimal, dependency-free Server-Sent Events client built on top of the
// Fetch Streams API. Unlike the browser's native EventSource, this supports
// POST requests with a JSON body — which our backend requires.
//
// The backend emits events framed as:
//   event: chunk
//   data: {"text":"..."}
//
//   event: done
//   data: {"ok":true}
//
//   event: error
//   data: {"message":"..."}

export type SSEEvent =
  | { type: "chunk"; text: string }
  | { type: "status"; message: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface StreamHandlers {
  onEvent: (event: SSEEvent) => void;
  signal?: AbortSignal;
}

/**
 * POST `body` to `url` and stream the SSE response, invoking `onEvent` for
 * every complete event. Resolves when the stream ends, rejects on network
 * or transport errors.
 */
export async function streamSSE(
  url: string,
  body: unknown,
  { onEvent, signal }: StreamHandlers
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });

  // Non-2xx before the SSE stream begins (e.g. 400 validation error).
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore parse errors */
    }
    onEvent({ type: "error", message });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseEvent(rawEvent);
        if (parsed) onEvent(parsed);
      }
    }
    // Flush any trailing event without a terminating blank line.
    if (buffer.trim()) {
      const parsed = parseEvent(buffer);
      if (parsed) onEvent(parsed);
    }
  } finally {
    reader.releaseLock();
  }
}

function parseEvent(raw: string): SSEEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  const data = dataLines.join("\n");
  if (!data) return null;

  try {
    const payload = JSON.parse(data);
    switch (event) {
      case "chunk":
        return { type: "chunk", text: payload.text ?? "" };
      case "status":
        return { type: "status", message: payload.message ?? "" };
      case "done":
        return { type: "done" };
      case "error":
        return { type: "error", message: payload.message ?? "Unknown error" };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
