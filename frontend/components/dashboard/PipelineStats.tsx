import { cn } from "@/lib/utils";
import type { PrioritiesResponse } from "@/types";

export function PipelineStats({ stats }: { stats: PrioritiesResponse["stats"] }) {
  const cells = [
    { label: "Companies", value: stats.total },
    { label: "Prospects", value: stats.prospects },
    { label: "Customers", value: stats.customers },
    { label: "Need attention", value: stats.needAttention, alert: true },
  ];

  return (
    <dl className="shadow-card flex divide-x rounded-xl border bg-card">
      {cells.map((cell) => (
        <div key={cell.label} className="flex-1 px-4 py-3">
          <dd
            className={cn(
              "tabular text-xl font-semibold tracking-tight",
              cell.alert && cell.value > 0 && "text-hot",
            )}
          >
            {cell.value}
          </dd>
          <dt className="mt-0.5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            {cell.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}
