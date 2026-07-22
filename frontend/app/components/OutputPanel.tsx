"use client";

interface OutputPanelProps {
  output: string;
  streaming: boolean;
  status: string | null;
  error: string | null;
  copied: boolean;
  onCopy: () => void;
}

export default function OutputPanel({
  output,
  streaming,
  status,
  error,
  copied,
  onCopy,
}: OutputPanelProps) {
  return (
    <div className="rounded-2xl border border-border bg-panel p-5 shadow-sm transition-colors">
      <div className="flex items-center justify-between mb-2">
        <span className="block text-sm font-semibold text-muted">Refined output</span>
        {output && !streaming && (
          <span className="text-[11px] text-muted">
            {output.length} characters
          </span>
        )}
      </div>

      <div className="min-h-[160px] rounded-xl border border-border bg-panel-2 p-3 text-sm text-text leading-relaxed transition-all">
        {output ? (
          <span>
            {output}
            {streaming && (
              <span className="inline-block w-[8px] h-[1.1em] bg-accent ml-[2px] align-text-bottom animate-caret" />
            )}
          </span>
        ) : (
          <span className="text-muted">
            Your polished message will appear here…
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onCopy}
          disabled={!output || streaming}
          className="rounded-xl border border-border bg-panel-2 px-4 py-2 text-sm font-semibold text-text transition-all hover:border-accent hover:text-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {status && (
        <div className="mt-3 rounded-xl border border-accent/40 bg-info-bg p-2.5 text-sm text-accent">
          {status}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-xl border border-danger/40 bg-danger-bg p-2.5 text-sm text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
