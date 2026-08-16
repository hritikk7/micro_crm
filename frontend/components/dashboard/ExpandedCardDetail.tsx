"use client";

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";

import { DraftMessagePanel } from "@/components/dashboard/DraftMessagePanel";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyInsight } from "@/hooks/useCompanyInsight";

export function ExpandedCardDetail({ companyId }: { companyId: string }) {
  const insight = useCompanyInsight(companyId);

  return (
    <div className="space-y-4">
      {insight.error ? (
        <p className="text-sm text-destructive">{insight.error}</p>
      ) : (
        <div className="space-y-3.5">
          <InsightSection
            icon={Sparkles}
            label="Relationship brief"
            text={insight.brief}
            loading={insight.isStreaming}
          />
          <InsightSection
            icon={AlertTriangle}
            label="The blocker"
            text={insight.blocker}
            loading={insight.isStreaming}
          />
          <InsightSection
            icon={ArrowRight}
            label="Next best action"
            text={insight.nextAction}
            loading={insight.isStreaming}
          />
        </div>
      )}

      <DraftMessagePanel companyId={companyId} />
    </div>
  );
}

function InsightSection({
  icon: Icon,
  label,
  text,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  text: string;
  loading: boolean;
}) {
  if (!text && !loading) return null;

  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        <Icon className="size-3" aria-hidden />
        {label}
      </p>
      {!text ? (
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ) : (
        <p className="text-sm leading-relaxed">
          {text}
          {loading && <span className="text-brand animate-caret ml-px">▍</span>}
        </p>
      )}
    </div>
  );
}
