import type { PrioritiesResponse } from "@/types";

export function PipelineStats({ stats }: { stats: PrioritiesResponse["stats"] }) {
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{stats.prospects}</span> Prospects ·{" "}
      <span className="font-medium text-foreground">{stats.customers}</span> Customers ·{" "}
      <span className="font-medium text-foreground">{stats.needAttention}</span> Need Attention
    </p>
  );
}
