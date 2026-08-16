"use client";

import { CompanyCard } from "@/components/dashboard/CompanyCard";
import { PipelineStats } from "@/components/dashboard/PipelineStats";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePriorities } from "@/hooks/usePriorities";

export function PriorityDashboard() {
  const { data, isLoading, error, mutate } = usePriorities();

  if (error) {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm text-destructive">Couldn&apos;t load the pipeline. {error.message}</p>
        <Button size="sm" variant="outline" onClick={() => mutate()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Priority Dashboard</h1>
        {isLoading || !data ? (
          <Skeleton className="mt-1.5 h-4 w-64" />
        ) : (
          <PipelineStats stats={data.stats} />
        )}
      </div>

      <div className="space-y-2.5">
        {isLoading || !data
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
          : data.companies.map((company) => (
              <CompanyCard key={company.id} company={company} onLogged={() => mutate()} />
            ))}
      </div>
    </div>
  );
}
