"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList, type ToolActivity } from "@/components/chat/MessageList";
import { streamChat } from "@/lib/api";
import type { ChatMessage } from "@/types";

const MAX_HISTORY_TURNS = 10;

export function PipelineChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  async function handleSend(message: string) {
    const userMessage: ChatMessage = { role: "user", content: message };
    const history = [...messages, userMessage].slice(-MAX_HISTORY_TURNS * 2);

    setMessages((prev) => [...prev, userMessage]);
    setStreamingContent("");
    setActiveTools([]);
    setIsStreaming(true);

    let fullResponse = "";
    try {
      for await (const event of streamChat({ message, session_history: history })) {
        if (event.type === "token" && event.content) {
          fullResponse += event.content;
          setStreamingContent(fullResponse);
        } else if (event.type === "tool_call" && event.toolName) {
          setActiveTools((prev) => [...prev, { toolName: event.toolName!, input: event.toolInput }]);
        } else if (event.type === "tool_result" && event.toolName) {
          setActiveTools((prev) =>
            prev.map((t) => (t.toolName === event.toolName && t.result === undefined ? { ...t, result: event.toolOutput ?? true } : t)),
          );
        } else if (event.type === "error") {
          toast.error(event.content ?? "Chat failed — try again");
        } else if (event.type === "done") {
          if (fullResponse) {
            setMessages((prev) => [...prev, { role: "assistant", content: fullResponse }]);
          }
          setStreamingContent("");
        }
      }
    } catch {
      toast.error("Chat failed — try again");
    } finally {
      setIsStreaming(false);
      setActiveTools([]);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <h2 className="text-lg font-semibold">Pipeline Chat</h2>
      <div className="min-h-0 flex-1">
        <MessageList
          messages={messages}
          streamingContent={streamingContent}
          activeTools={activeTools}
          isStreaming={isStreaming}
        />
      </div>
      <ChatInput onSend={handleSend} disabled={isStreaming} />
    </div>
  );
}
