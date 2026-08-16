import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

export interface ToolActivity {
  toolName: string;
  input?: Record<string, unknown>;
  result?: unknown;
}

export function MessageList({
  messages,
  streamingContent,
  activeTools,
  isStreaming,
}: {
  messages: ChatMessage[];
  streamingContent: string;
  activeTools: ToolActivity[];
  isStreaming: boolean;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-1">
        {messages.length === 0 && !isStreaming && (
          <p className="text-sm text-muted-foreground">
            Ask about your pipeline, or tell me about a call/email you just had.
          </p>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed",
              m.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-muted",
            )}
          >
            {m.content}
          </div>
        ))}

        {isStreaming && (
          <div className="max-w-[85%] self-start space-y-1.5">
            {activeTools.map((t, i) => (
              <div key={i} className="rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                {t.result !== undefined ? `✓ ${t.toolName}` : `→ calling ${t.toolName}…`}
              </div>
            ))}
            {streamingContent && (
              <div className="rounded-lg bg-muted px-3 py-2 text-sm leading-relaxed">
                {streamingContent}
                <span className="animate-pulse">▍</span>
              </div>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
