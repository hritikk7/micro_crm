"use client";

import { Check, Loader2 } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

export interface ToolActivity {
  toolName: string;
  input?: Record<string, unknown>;
  result?: unknown;
}

const EXAMPLES = [
  "Which deals are at risk?",
  "What did I discuss with Acme Retail?",
  "Who haven't I contacted in a month?",
];

export function MessageList({
  messages,
  streamingContent,
  activeTools,
  isStreaming,
  onExampleClick,
}: {
  messages: ChatMessage[];
  streamingContent: string;
  activeTools: ToolActivity[];
  isStreaming: boolean;
  onExampleClick?: (message: string) => void;
}) {
  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 px-4 py-4">
        {isEmpty && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="max-w-[24ch] text-sm text-muted-foreground">
              Ask about your pipeline, or tell me about a call you just had.
            </p>
            <div className="flex flex-col items-stretch gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => onExampleClick?.(example)}
                  className="hover:border-brand/40 hover:text-foreground rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground"
            >
              {m.content}
            </div>
          ) : (
            <div key={i} className="text-sm leading-relaxed whitespace-pre-wrap">
              {m.content}
            </div>
          ),
        )}

        {isStreaming && (
          <div className="space-y-2">
            {activeTools.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {activeTools.map((t, i) => (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px]",
                      t.result !== undefined
                        ? "text-muted-foreground"
                        : "border-brand/30 bg-brand-muted text-brand",
                    )}
                  >
                    {t.result !== undefined ? (
                      <Check className="text-stable size-3" />
                    ) : (
                      <Loader2 className="size-3 animate-spin" />
                    )}
                    {t.toolName}
                  </span>
                ))}
              </div>
            )}
            {streamingContent && (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {streamingContent}
                <span className="text-brand animate-caret ml-px">▍</span>
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
