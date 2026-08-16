"use client";

import { useState } from "react";
import { Check, Copy, PenLine, RotateCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { streamDraft } from "@/lib/api";

export function DraftMessagePanel({ companyId }: { companyId: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  async function handleDraft() {
    setDraft("");
    setIsStreaming(true);
    setJustCopied(false);
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
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
  }

  if (draft === null) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 bg-card text-xs"
        onClick={handleDraft}
        disabled={isStreaming}
      >
        <PenLine className="size-3.5" />
        Draft message
      </Button>
    );
  }

  return (
    <div className="relative rounded-lg border bg-card">
      <div className="absolute top-2 right-2 flex gap-0.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={handleCopy}
          disabled={isStreaming || !draft}
          aria-label="Copy draft"
        >
          {justCopied ? <Check className="text-stable size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={handleDraft}
          disabled={isStreaming}
          aria-label="Regenerate draft"
        >
          <RotateCw className="size-3.5" />
        </Button>
      </div>

      <pre className="px-3.5 py-3 pr-20 font-sans text-sm leading-relaxed whitespace-pre-wrap">
        {draft}
        {isStreaming && <span className="text-brand animate-caret">▍</span>}
      </pre>
    </div>
  );
}
