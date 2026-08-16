"use client";

import { AlertCircle } from "lucide-react";

import { CompanyCard } from "@/components/dashboard/CompanyCard";
import { PipelineStats } from "@/components/dashboard/PipelineStats";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePriorities } from "@/hooks/usePriorities";

export function PriorityDashboard() {
  const { data, isLoading, error, mutate } = usePriorities();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight">Priority</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Your pipeline, ordered by who needs you most.
        </p>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
          <AlertCircle className="mt-px size-4 shrink-0 text-destructive" />
          <div className="space-y-2.5">
            <p className="text-sm text-destructive">
              Couldn&apos;t load the pipeline. {error.message}
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => mutate()}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <>
          {isLoading || !data ? <StatsSkeleton /> : <PipelineStats stats={data.stats} />}

          <div className="space-y-2.5">
            {isLoading || !data
              ? Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
              : data.companies.map((company) => (
                  <CompanyCard key={company.id} company={company} onLogged={() => mutate()} />
                ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="shadow-card flex divide-x rounded-xl border bg-card">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex-1 space-y-2 px-4 py-3">
          <Skeleton className="h-5 w-8" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="shadow-card relative overflow-hidden rounded-xl border bg-card px-5 py-3.5">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-border" aria-hidden />
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3.5 w-full max-w-md" />
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="h-2.5 w-28" />
      </div>
    </div>
  );
}
