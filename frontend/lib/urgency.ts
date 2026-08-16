import type { CompanyWithScore, UrgencyLevel } from "@/types";

/**
 * Urgency is rendered as a coloured left rail on the card plus a dot + label —
 * scannable down a long list without emoji or shouty uppercase. Colours come
 * from the semantic urgency tokens in globals.css, kept deliberately separate
 * from the blue UI accent so signal never competes with chrome.
 */
export const URGENCY_META: Record<
  UrgencyLevel,
  {
    label: string;
    railClassName: string;
    dotClassName: string;
    textClassName: string;
    softClassName: string;
  }
> = {
  hot: {
    label: "Hot",
    railClassName: "bg-hot",
    dotClassName: "bg-hot",
    textClassName: "text-hot",
    softClassName: "bg-hot-soft",
  },
  watch: {
    label: "Watch",
    railClassName: "bg-watch",
    dotClassName: "bg-watch",
    textClassName: "text-watch",
    softClassName: "bg-watch-soft",
  },
  stable: {
    label: "Stable",
    railClassName: "bg-stable",
    dotClassName: "bg-stable",
    textClassName: "text-stable",
    softClassName: "bg-stable-soft",
  },
  stale: {
    label: "Stale",
    railClassName: "bg-stale",
    dotClassName: "bg-stale",
    textClassName: "text-stale",
    softClassName: "bg-stale-soft",
  },
};

export function daysSince(dateStr: string): number {
  const diffMs = Date.now() - new Date(`${dateStr}T00:00:00Z`).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

export function formatLastContact(dateStr: string | null): string {
  if (!dateStr) return "No contact yet";
  const days = daysSince(dateStr);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** Compact age for dense meta rows: `12d`, `3w`, `4mo`, `2y`. */
export function formatCompact(dateStr: string | null): string {
  if (!dateStr) return "—";
  const days = daysSince(dateStr);
  if (days === 0) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/**
 * Derives the one-line reason + recommended action for a collapsed card.
 * TRD's company_scores no longer carries AI-generated reason/action fields
 * (priority_service was removed) — this is a client-side heuristic filling
 * that gap until/unless the backend decides to persist something richer.
 *
 * Copy is kept short and date-free: the card already renders a formatted age
 * in its meta row, so repeating the raw ISO date here is redundant.
 */
export function deriveCardCopy(company: CompanyWithScore): { reason: string; action: string } {
  const last = company.lastInteraction;

  if (!last) {
    return {
      reason: "No interactions logged yet.",
      action: "Schedule an initial outreach call",
    };
  }

  const who = last.contactName ?? "your contact";
  const days = daysSince(last.date);

  switch (company.score.urgency) {
    case "hot":
      return {
        reason: `Flagged hot after the last ${last.type} with ${who} — ${days}d with no follow-through.`,
        action: `Reach out to ${who} today`,
      };
    case "watch":
      return {
        reason: `Something's still open from the last ${last.type} with ${who}.`,
        action: `Check in with ${who}`,
      };
    case "stable":
      return {
        reason: `On track since the last ${last.type} with ${who}.`,
        action: `No action needed — next natural touchpoint is fine`,
      };
    case "stale":
      return {
        reason: `No meaningful contact in ${days} days — last was a ${last.type} with ${who}.`,
        action: `Re-engage ${who} before this goes cold`,
      };
  }
}
