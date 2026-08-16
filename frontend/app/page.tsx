import { PipelineChat } from "@/components/chat/PipelineChat";
import { PriorityDashboard } from "@/components/dashboard/PriorityDashboard";
import { TopBar } from "@/components/layout/TopBar";

export default function Home() {
  return (
    <>
      <TopBar />
      <div className="mx-auto grid w-full max-w-[1200px] flex-1 grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <main className="min-w-0">
          <PriorityDashboard />
        </main>
        <aside className="lg:sticky lg:top-16 lg:h-[calc(100vh-6rem)]">
          <div className="shadow-card flex h-full min-h-[480px] flex-col overflow-hidden rounded-xl border bg-card">
            <PipelineChat />
          </div>
        </aside>
      </div>
    </>
  );
}
