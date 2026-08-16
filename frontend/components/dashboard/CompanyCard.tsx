"use client";

import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

import { ExpandedCardDetail } from "@/components/dashboard/ExpandedCardDetail";
import { QuickLogForm } from "@/components/dashboard/QuickLogForm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveCardCopy, formatCompact, URGENCY_META } from "@/lib/urgency";
import type { CompanyWithScore } from "@/types";

export function CompanyCard({
  company,
  onLogged,
}: {
  company: CompanyWithScore;
  onLogged: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLogging, setIsLogging] = useState(false);

  const meta = URGENCY_META[company.score.urgency];
  const { reason, action } = deriveCardCopy(company);
  const isOpen = isExpanded || isLogging;

  function toggleExpanded() {
    setIsExpanded((v) => !v);
    setIsLogging(false);
  }

  return (
    <div
      className={cn(
        "group shadow-card relative overflow-hidden rounded-xl border bg-card transition-shadow",
        "hover:shadow-card-hover focus-within:shadow-card-hover",
      )}
    >
      {/* Urgency rail */}
      <div className={cn("absolute inset-y-0 left-0 w-[3px]", meta.railClassName)} aria-hidden />

      <div className="flex items-start justify-between gap-4 px-5 py-3.5">
        {/* The summary is the expand affordance; the action cluster is a sibling
            rather than a child so we never nest interactive elements. */}
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={isExpanded}
          className="min-w-0 flex-1 cursor-pointer text-left outline-none"
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="truncate text-sm font-medium">{company.name}</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    meta.dotClassName,
                    company.score.urgency === "hot" && "animate-pulse",
                  )}
                  aria-hidden
                />
                <span className={cn("text-xs font-medium", meta.textClassName)}>{meta.label}</span>
              </span>
              <span className="text-xs text-muted-foreground capitalize">{company.status}</span>
            </div>

            <p className="text-sm text-muted-foreground">{reason}</p>
            <p className="text-sm">
              <span className="text-brand mr-1.5" aria-hidden>
                →
              </span>
              {action}
            </p>
            <p className="tabular pt-0.5 font-mono text-[11px] text-muted-foreground">
              Last contact · {formatCompact(company.lastContactDate)}
            </p>
          </div>
        </button>

        <div
          className={cn(
            "flex shrink-0 items-center gap-1 transition-opacity",
            "opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100",
            isOpen && "lg:opacity-100",
          )}
        >
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              setIsLogging((v) => !v);
              setIsExpanded(false);
            }}
          >
            <Plus className="size-3" />
            Log
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            onClick={toggleExpanded}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse details" : "Expand details"}
          >
            <ChevronDown className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
          </Button>
        </div>
      </div>

      {isLogging && (
        <div className="border-t bg-muted/40 px-5 py-4">
          <QuickLogForm
            company={company}
            onCancel={() => setIsLogging(false)}
            onSaved={() => {
              setIsLogging(false);
              onLogged();
            }}
          />
        </div>
      )}

      {isExpanded && !isLogging && (
        <div className="border-t bg-muted/40 px-5 py-4">
          <ExpandedCardDetail companyId={company.id} />
        </div>
      )}
    </div>
  );
}
