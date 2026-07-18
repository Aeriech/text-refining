"use client";

import { useCallback, useState } from "react";

/**
 * Copies text to the clipboard and exposes a transient `copied` flag for UI
 * feedback. Falls back to a hidden textarea on insecure contexts.
 */
export function useClipboard(resetMs = 1800) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), resetMs);
      } catch {
        setCopied(false);
      }
    },
    [resetMs]
  );

  return { copied, copy };
}
