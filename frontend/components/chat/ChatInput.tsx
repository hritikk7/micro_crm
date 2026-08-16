"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="focus-within:border-brand focus-within:ring-brand/25 flex items-center gap-2 rounded-lg border bg-card py-1 pr-1 pl-3 transition-shadow focus-within:ring-2"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ask about your pipeline…"
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
      <Button
        type="submit"
        size="icon"
        className="size-7 shrink-0 rounded-md"
        disabled={disabled || !value.trim()}
        aria-label="Send message"
      >
        <ArrowUp className="size-3.5" />
      </Button>
    </form>
  );
}
