"use client";

import { useEffect, useState } from "react";

import { streamInsight } from "@/lib/api";

interface InsightState {
  brief: string;
  blocker: string;
  nextAction: string;
  isStreaming: boolean;
  error: string | null;
}

const EMPTY_STATE: InsightState = {
  brief: "",
  blocker: "",
  nextAction: "",
  isStreaming: false,
  error: null,
};

/**
 * Streams a company's AI insight (brief/blocker/next action) via SSE,
 * accumulating tokens into per-section state. Re-runs whenever companyId
 * changes; pass null/undefined to keep it idle (e.g. before a card expands).
 */
export function useCompanyInsight(companyId: string | null) {
  const [state, setState] = useState<InsightState>(EMPTY_STATE);

  useEffect(() => {
    // No-op when idle — state already starts at EMPTY_STATE on mount, and in
    // practice this hook is only invoked with a real companyId (ExpandedCardDetail
    // renders it lazily on expand).
    if (!companyId) return;

    let cancelled = false;
    let activeKey: "brief" | "blocker" | "nextAction" = "brief";

    (async () => {
      setState({ ...EMPTY_STATE, isStreaming: true });
      try {
        for await (const event of streamInsight(companyId)) {
          if (cancelled) return;

          if (event.type === "section_start" && event.section) {
            activeKey = event.section === "next_action" ? "nextAction" : event.section;
          } else if (event.type === "token" && event.content) {
            const key = activeKey;
            const chunk = event.content;
            setState((prev) => ({ ...prev, [key]: prev[key] + chunk }));
          } else if (event.type === "error") {
            setState((prev) => ({ ...prev, isStreaming: false, error: event.content ?? "Insight unavailable" }));
          } else if (event.type === "done") {
            setState((prev) => ({ ...prev, isStreaming: false }));
          }
        }
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isStreaming: false, error: "Insight unavailable — try again" }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return state;
}
