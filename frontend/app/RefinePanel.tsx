"use client";

import { useCallback, useRef, useState } from "react";
import { streamSSE, type SSEEvent } from "@/lib/sseClient";
import { useClipboard } from "@/lib/useClipboard";

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

  const canSubmit = text.trim().length > 0 && !streaming;

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
      await streamSSE(
        API_URL,
        { text, formality: scores.formality, friendliness: scores.friendliness },
        { onEvent: handleEvent, signal: controller.signal }
      );
      // If neither done nor error arrived (e.g. empty stream), reset state.
      setStreaming((s) => (s ? false : s));
      setStatus((s) => (s === "Refining…" ? null : s));
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("Cancelled.");
      } else {
        setError("Network error — is the backend running on :8080?");
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
    <div className="container">
      <h1 className="title">Refine Text</h1>
      <p className="subtitle">
        Polish messy messages with adjustable tone. Results stream in real time.
      </p>

      <div className="grid">
        <div className="panel">
          <label className="label" htmlFor="input">
            Your message
          </label>
          <textarea
            id="input"
            placeholder="e.g. hey can u send me the doc asap thx"
            value={text}
            disabled={streaming}
            onChange={(e) => setText(e.target.value)}
          />

          <div style={{ marginTop: 16 }}>
            <div className="slider-row">
              <span className="label" style={{ margin: 0 }}>
                Formality
              </span>
              <span className="slider-val">{scores.formality}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={scores.formality}
              disabled={streaming}
              onChange={(e) =>
                setScores((s) => ({ ...s, formality: Number(e.target.value) }))
              }
            />

            <div className="slider-row" style={{ marginTop: 12 }}>
              <span className="label" style={{ margin: 0 }}>
                Friendliness
              </span>
              <span className="slider-val">{scores.friendliness}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={scores.friendliness}
              disabled={streaming}
              onChange={(e) =>
                setScores((s) => ({
                  ...s,
                  friendliness: Number(e.target.value),
                }))
              }
            />
          </div>

          <div className="actions">
            {!streaming ? (
              <button
                className="btn-primary"
                onClick={onSubmit}
                disabled={!canSubmit}
              >
                Refine
              </button>
            ) : (
              <button className="btn-secondary" onClick={onStop}>
                Stop
              </button>
            )}
          </div>
        </div>

        <div className="panel">
          <label className="label">Refined output</label>
          <div className="output">
            {output ? (
              <>
                {output}
                {streaming && <span className="caret" />}
              </>
            ) : (
              <span className="placeholder">
                Your polished message will appear here…
              </span>
            )}
          </div>

          <div className="actions">
            <button
              className="btn-secondary"
              onClick={() => copy(output)}
              disabled={!output || streaming}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {status && <div className="banner banner-info">{status}</div>}
          {error && <div className="banner banner-error">{error}</div>}
          {output && !streaming && (
            <div className="meta">{output.length} characters</div>
          )}
        </div>
      </div>
    </div>
  );
}
