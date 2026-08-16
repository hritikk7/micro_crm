"use client";

import { DraftMessagePanel } from "@/components/dashboard/DraftMessagePanel";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyInsight } from "@/hooks/useCompanyInsight";

export function ExpandedCardDetail({ companyId }: { companyId: string }) {
  const insight = useCompanyInsight(companyId);

  return (
    <div className="space-y-4 border-t pt-4" onClick={(e) => e.stopPropagation()}>
      {insight.error ? (
        <p className="text-sm text-destructive">{insight.error}</p>
      ) : (
        <>
          <InsightSection label="AI Relationship Brief" text={insight.brief} loading={insight.isStreaming} />
          <InsightSection label="The Blocker" text={insight.blocker} loading={insight.isStreaming} />
          <InsightSection label="Next Best Action" text={insight.nextAction} loading={insight.isStreaming} />
        </>
      )}

      <Separator />

      <DraftMessagePanel companyId={companyId} />
    </div>
  );
}

function InsightSection({ label, text, loading }: { label: string; text: string; loading: boolean }) {
  if (!text && loading) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }
  if (!text) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}
