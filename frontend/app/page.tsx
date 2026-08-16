import { PipelineChat } from "@/components/chat/PipelineChat";
import { PriorityDashboard } from "@/components/dashboard/PriorityDashboard";

export default function Home() {
  return (
    <div className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_380px]">
      <main className="min-w-0">
        <PriorityDashboard />
      </main>
      <aside className="min-h-[400px] lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
        <div className="h-full rounded-xl border bg-card p-4">
          <PipelineChat />
        </div>
      </aside>
    </div>
  );
}
