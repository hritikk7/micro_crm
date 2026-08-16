import { ThemeToggle } from "@/components/layout/ThemeToggle";

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 h-12 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1200px] items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-5 items-center justify-center rounded-[5px] bg-primary text-[10px] font-bold text-primary-foreground">
            M
          </div>
          <span className="text-[13px] font-semibold tracking-tight">Micro-CRM</span>
          <span className="ml-1 hidden rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground sm:inline">
            Pipeline
          </span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
