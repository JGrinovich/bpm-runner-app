import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Library, LogOut, Music2, Sparkles } from "lucide-react";

import { clearToken } from "@/api";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const libraryActive = pathname === "/library" || pathname.startsWith("/tracks/");

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "relative flex w-64 shrink-0 flex-col border-r border-sidebar-border",
          "bg-[linear-gradient(180deg,hsl(222_47%_9%)_0%,hsl(217_55%_18%)_45%,hsl(199_60%_28%)_100%)]",
          "text-sidebar-foreground shadow-xl"
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(199_89%_48%/0.35),transparent_55%)] pointer-events-none" />
        <div className="relative flex h-full flex-col p-4">
          <div className="mb-6 flex items-center gap-2 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary/20 text-sidebar-primary ring-1 ring-sidebar-primary/40">
              <Music2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-sidebar-foreground/70">
                BPM Runner
              </p>
              <p className="text-sm font-semibold text-sidebar-foreground">Studio</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            <Button
              variant="ghost"
              className={cn(
                "h-auto w-full justify-start gap-2 px-3 py-2.5 text-sidebar-foreground shadow-none",
                libraryActive
                  ? "bg-sidebar-accent text-sidebar-primary-foreground hover:bg-sidebar-accent hover:text-sidebar-primary-foreground"
                  : "hover:bg-sidebar-accent/80 hover:text-sidebar-foreground"
              )}
              onClick={() => navigate("/library")}
            >
              <Library className="h-4 w-4 text-sidebar-primary" />
              Library
            </Button>
          </nav>

          <div className="mt-auto space-y-3 pt-6">
            <Separator className="bg-sidebar-border" />
            <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/50 px-3 py-2 text-xs text-sidebar-foreground/85 ring-1 ring-sidebar-border/60">
              <Sparkles className="h-4 w-4 shrink-0 text-sidebar-primary" />
              <span>Match your music to your run cadence.</span>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={() => {
                clearToken();
                navigate("/auth");
              }}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          </div>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          className={cn(
            "pointer-events-none absolute inset-0 -z-10",
            "bg-[radial-gradient(ellipse_80%_50%_at_20%_-10%,hsl(199_89%_70%/0.35),transparent),radial-gradient(ellipse_60%_40%_at_100%_0%,hsl(217_91%_60%/0.2),transparent)]"
          )}
        />
        <div className="flex min-h-screen flex-1 flex-col bg-gradient-to-br from-[hsl(210_55%_97%)] via-[hsl(210_60%_96%)] to-[hsl(214_70%_92%)]">
          <main className="flex-1 p-6 md:p-8">
            <div className="mx-auto max-w-4xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
