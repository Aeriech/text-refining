import { ChatSession, GoogleGenerativeAI } from "@google/generative-ai";

type SSEEvent =
  | { readonly type: "chunk"; text: string }
  | { readonly type: "status"; message: string }
  | { readonly type: "done"; ok: boolean }
  | { readonly type: "error"; message: string }
  | { readonly type: "completed" }
  | { readonly type: "aborted" };

const FREE_TIER_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
] as const;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY environment variable");
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("resource has been exhausted")
  );
}

function humanizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const idx = msg.indexOf(":");
  return idx !== -1 ? msg.slice(idx + 1).trim() : msg;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function describeAxis(
  name: string,
  v: number,
  low: string,
  mid: string,
  high: string
): string {
  const score = clamp(v, 1, 10);
  switch (true) {
    case score <= 3:
      return `${name} ${score}/10 — ${low}`;
    case score <= 7:
      return `${name} ${score}/10 — ${mid}`;
    default:
      return `${name} ${score}/10 — ${high}`;
  }
}

function buildSystemPrompt(formality: number, friendliness: number): string {
  const f = clamp(formality, 1, 10);
  const w = clamp(friendliness, 1, 10);

  const tone = describeAxis(
    "formality",
    f,
    "extremely casual, slangy, and relaxed",
    "balanced and neutral",
    "highly formal, precise, and professional"
  );
  const warmth = describeAxis(
    "friendliness",
    w,
    "direct, terse, and matter-of-fact",
    "balanced and polite",
    "warm, encouraging, and empathetic"
  );

  return [
    "You are a professional writing assistant that refines a user's rough, messy message into a polished version.",
    "You ONLY return the rewritten message. No explanations, no headings, no quotes around the output.",
    "",
    `Target tone: ${tone}.`,
    `Target warmth: ${warmth}.`,
    `Formality score (1-10): ${f}.`,
    `Friendliness score (1-10): ${w}.`,
    "",
    "Rules:",
    "- Preserve the user's original meaning, intent, and any key facts or names.",
    "- Fix grammar, spelling, and punctuation.",
    "- Do not add new information that was not implied by the original.",
    "- Keep the length roughly similar to the original unless clarity demands otherwise.",
  ].join("\n");
}

async function* runStreamWithFallback(
  promptText: string,
  formality: number,
  friendliness: number,
  signal: AbortSignal
): AsyncGenerator<SSEEvent> {
  const systemInstruction = buildSystemPrompt(formality, friendliness);

  for (let modelIdx = 0; modelIdx < FREE_TIER_MODELS.length; modelIdx++) {
    const model = FREE_TIER_MODELS[modelIdx];
    let session: ChatSession | null = null;

    try {
      if (modelIdx > 0) {
        const backoffMs = Math.min(modelIdx * 700, 4000);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, backoffMs);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          }, { once: true });
        });
        if (signal.aborted) {
          yield { type: "aborted" };
          return;
        }
      }

      const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!);
      const generativeModel = genAI.getGenerativeModel({ model });
      const systemInstructionContent = { role: "user", parts: [{ text: systemInstruction }] };
      session = generativeModel.startChat({
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        systemInstruction: systemInstructionContent,
      });

      const { stream } = await session.sendMessageStream(promptText);

      let streamed = false;

      try {
        for await (const chunk of stream) {
          if (signal.aborted) {
            yield { type: "aborted" };
            return;
          }
          const text = chunk.text();
          if (!text) continue;
          streamed = true;
          yield { type: "chunk", text };
        }
      } finally {
        session = null;
      }

      if (streamed) {
        yield { type: "status", message: `via ${model}` };
        yield { type: "done", ok: true };
        yield { type: "completed" };
        return;
      }

      yield {
        type: "error",
        message: `Model ${model} returned no content.`,
      };
      yield { type: "completed" };
      return;
    } catch (err) {
      if (signal.aborted) {
        yield { type: "aborted" };
        return;
      }

      if (isRateLimitError(err)) {
        yield {
          type: "status",
          message: `Model ${model} is rate-limited — switching… (${humanizeError(err)})`,
        };
        if (modelIdx === FREE_TIER_MODELS.length - 1) {
          yield {
            type: "error",
            message: "All available AI models are rate-limited right now. Please try again in a moment.",
          };
          yield { type: "completed" };
          return;
        }
        continue;
      }

      const errorMsg = `Generation failed: ${humanizeError(err)}`;
      yield { type: "error", message: errorMsg };
      yield { type: "completed" };
      return;
    } finally {
      session = null;
    }
  }

  yield {
    type: "error",
    message: "All available AI models are rate-limited right now. Please try again in a moment.",
  };
  yield { type: "completed" };
}

export async function POST(request: Request) {
  let signal: AbortSignal;

  try {
    signal = request.signal;
  } catch {
    return new Response(JSON.stringify({ error: "invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { text: string; formality: number; friendliness: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body.text !== "string" || body.text.trim() === "") {
    return new Response(JSON.stringify({ error: "text must not be empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const formality = clamp(body.formality ?? 5, 1, 10);
  const friendliness = clamp(body.friendliness ?? 5, 1, 10);

  if (
    body.formality < 1 ||
    body.formality > 10 ||
    body.friendliness < 1 ||
    body.friendliness > 10
  ) {
    return new Response(
      JSON.stringify({ error: "scores must be between 1 and 10" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const streamGen = runStreamWithFallback(
    body.text,
    formality,
    friendliness,
    signal
  );

  const encoder = new TextEncoder();

  const abortable = signal as AbortSignal & { abort: () => void };
  const bodyStream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await streamGen.next();
        if (done) {
          controller.close();
          return;
        }

        const ev = value;
        const payload = encoder.encode(
          `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`
        );
        controller.enqueue(payload);
      } catch {
        controller.close();
      }
    },
    cancel() {
      abortable.abort();
    },
  });

  return new Response(bodyStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  return new Response(JSON.stringify({ error: "method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
