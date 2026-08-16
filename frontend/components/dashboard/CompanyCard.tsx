"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { ExpandedCardDetail } from "@/components/dashboard/ExpandedCardDetail";
import { QuickLogForm } from "@/components/dashboard/QuickLogForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { deriveCardCopy, formatLastContact, URGENCY_META } from "@/lib/urgency";
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

  return (
    <Card
      className="cursor-pointer gap-3 px-4 transition-shadow hover:shadow-sm"
      onClick={() => setIsExpanded((v) => !v)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={meta.badgeClassName}>
              {meta.emoji} {meta.label.toUpperCase()}
            </Badge>
            <span className="text-sm font-medium">{company.name}</span>
            <span className="text-xs text-muted-foreground capitalize">{company.status}</span>
          </div>
          <p className="text-sm text-muted-foreground">{reason}</p>
          <p className="text-sm font-medium">{action}</p>
          <p className="text-xs text-muted-foreground">
            Last contact: {formatLastContact(company.lastContactDate)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setIsLogging((v) => !v);
              setIsExpanded(false);
            }}
          >
            + Log
          </Button>
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")}
          />
        </div>
      </div>

      {isLogging && (
        <QuickLogForm
          company={company}
          onCancel={() => setIsLogging(false)}
          onSaved={() => {
            setIsLogging(false);
            onLogged();
          }}
        />
      )}

      {isExpanded && !isLogging && <ExpandedCardDetail companyId={company.id} />}
    </Card>
  );
}
