import type { CompanyWithScore, UrgencyLevel } from "@/types";

export const URGENCY_META: Record<
  UrgencyLevel,
  { label: string; emoji: string; badgeClassName: string }
> = {
  hot: { label: "Hot", emoji: "🔴", badgeClassName: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400" },
  watch: {
    label: "Watch",
    emoji: "🟡",
    badgeClassName: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
  },
  stable: {
    label: "Stable",
    emoji: "🟢",
    badgeClassName: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400",
  },
  stale: {
    label: "Stale",
    emoji: "⚫",
    badgeClassName: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-400",
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

/**
 * Derives the one-line reason + recommended action for a collapsed card.
 * TRD's company_scores no longer carries AI-generated reason/action fields
 * (priority_service was removed) — this is a client-side heuristic filling
 * that gap until/unless the backend decides to persist something richer.
 */
export function deriveCardCopy(company: CompanyWithScore): { reason: string; action: string } {
  const last = company.lastInteraction;

  if (!last) {
    return {
      reason: "No interactions logged yet.",
      action: "Schedule an initial outreach or discovery call.",
    };
  }

  const who = last.contactName ?? "your contact";
  const days = daysSince(last.date);

  switch (company.score.urgency) {
    case "hot":
      return {
        reason: `Marked Hot after the ${last.date} ${last.type} with ${who} — ${days}d with no follow-through.`,
        action: `Reach out to ${who} now — this was flagged as time-sensitive.`,
      };
    case "watch":
      return {
        reason: `Marked Watch after the ${last.date} ${last.type} with ${who}.`,
        action: `Check in with ${who} — something's still open.`,
      };
    case "stable":
      return {
        reason: `On track since the ${last.date} ${last.type} with ${who}.`,
        action: `No urgent action — next natural touchpoint with ${who} is fine.`,
      };
    case "stale":
      return {
        reason: `No meaningful contact in ${days} days (last: ${last.date} ${last.type} with ${who}).`,
        action: `Re-engage ${who} — this relationship is going cold.`,
      };
  }
}
