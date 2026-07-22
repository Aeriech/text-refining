"use client";

import { useCallback, useRef, useState } from "react";
import { type SSEEvent, streamSSE } from "@/lib/sseClient";
import { useClipboard } from "@/lib/useClipboard";
import InputPanel from "./components/InputPanel";
import OutputPanel from "./components/OutputPanel";

const API_URL = "/api/draft";

interface Scores {
  formality: number;
  friendliness: number;
}

export default function RefinePanel() {
  const [text, setText] = useState("");
  const [scores, setScores] = useState<Scores>({
    formality: 5,
    friendliness: 5,
  });
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  const { copied, copy } = useClipboard();
  const abortRef = useRef<AbortController | null>(null);

  const handleEvent = useCallback((ev: SSEEvent) => {
    switch (ev.type) {
      case "chunk":
        setOutput((prev) => prev + ev.text);
        break;
      case "status":
        setStatus(ev.message);
        break;
      case "done":
        setStreaming(false);
        setStatus(null);
        break;
      case "error":
        setError(ev.message);
        setStreaming(false);
        setStatus(null);
        break;
    }
  }, []);

  const onSubmit = useCallback(async () => {
    setError(null);
    setStatus("Refining…");
    setOutput("");
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamSSE(API_URL, { text, formality: scores.formality, friendliness: scores.friendliness }, { onEvent: handleEvent, signal: controller.signal });
      setStreaming((s) => (s ? false : s));
      setStatus((s) => (s === "Refining…" ? null : s));
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("Cancelled.");
      } else {
        setError("Network error — is the backend running?");
      }
      setStreaming(false);
    }
  }, [text, scores, handleEvent]);

  const onStop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setStatus("Cancelled.");
  }, []);

  return (
    <div className="mx-auto max-w-[880px] px-5 py-12 sm:py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-text">
          Refine Text
        </h1>
        <p className="mt-2 text-sm text-muted">
          Polish messy messages with adjustable tone. Results stream in real time.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <InputPanel
          text={text}
          onTextChange={setText}
          formality={scores.formality}
          onFormalityChange={(v) => setScores((s) => ({ ...s, formality: v }))}
          friendliness={scores.friendliness}
          onFriendlinessChange={(v) => setScores((s) => ({ ...s, friendliness: v }))}
          disabled={streaming}
          onSubmit={onSubmit}
          onStop={onStop}
          streaming={streaming}
        />
        <OutputPanel
          output={output}
          streaming={streaming}
          status={status}
          error={error}
          copied={copied}
          onCopy={() => copy(output)}
        />
      </div>
    </div>
  );
}
