"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { streamDraft } from "@/lib/api";

export function DraftMessagePanel({ companyId }: { companyId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  async function handleDraft() {
    setDraft("");
    setIsStreaming(true);
    try {
      for await (const event of streamDraft(companyId)) {
        if (event.type === "token" && event.content) {
          setDraft((prev) => (prev ?? "") + event.content);
        } else if (event.type === "error") {
          toast.error(event.content ?? "Draft unavailable — try again");
          setDraft(null);
        }
      }
    } finally {
      setIsStreaming(false);
    }
  }

  async function handleCopy() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    toast.success("Copied to clipboard");
  }

  return (
    <div className="space-y-2">
      {draft === null ? (
        <Button size="sm" variant="secondary" onClick={handleDraft} disabled={isStreaming}>
          Draft Message
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <pre className="whitespace-pre-wrap font-sans text-sm">
            {draft}
            {isStreaming && <span className="animate-pulse">▍</span>}
          </pre>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy} disabled={isStreaming || !draft}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDraft} disabled={isStreaming}>
              Regenerate
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
