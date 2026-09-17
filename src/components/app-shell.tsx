"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Settings, Check } from "lucide-react";
import { STEPS, furthestStep, useMerge } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state } = useMerge();
  const isSettings = pathname?.startsWith("/reglages");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Boxes className="text-primary size-5" />
            Modpack Merger
          </Link>

          <div className="flex-1" />

          <Button
            asChild
            variant={isSettings ? "secondary" : "ghost"}
            size="sm"
            aria-label="Parametres"
          >
            <Link href="/reglages/">
              <Settings />
              <span className="hidden sm:inline">Parametres</span>
            </Link>
          </Button>
        </div>

        {!isSettings && <Stepper state={state} pathname={pathname ?? "/"} />}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="text-muted-foreground border-t py-6 text-center text-xs">
        Donnees Modrinth et CurseForge · tes archives restent sur ta machine, rien n&apos;est
        televerse.
      </footer>
    </div>
  );
}

function Stepper({ state, pathname }: { state: ReturnType<typeof useMerge>["state"]; pathname: string }) {
  const max = furthestStep(state);
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.href === pathname),
  );

  return (
    <nav className="mx-auto w-full max-w-6xl px-4 pb-3" aria-label="Etapes">
      <ol className="flex items-center gap-1 overflow-x-auto">
        {STEPS.map((step, i) => {
          const reachable = i <= max;
          const active = i === current;
          const done = i < current && reachable;

          const content = (
            <span
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                active && "bg-primary/10 text-primary",
                !active && reachable && "text-muted-foreground hover:bg-muted",
                !reachable && "text-muted-foreground/40",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  active && "border-primary bg-primary text-primary-foreground",
                  done && "border-primary/40 bg-primary/15 text-primary",
                  !active && !done && "border-current",
                )}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
              <span className="sm:hidden">{step.short}</span>
            </span>
          );

          return (
            <li key={step.href} className="flex items-center">
              {reachable ? (
                <Link href={step.href}>{content}</Link>
              ) : (
                <span aria-disabled className="cursor-not-allowed">
                  {content}
                </span>
              )}
              {i < STEPS.length - 1 && (
                <span className="bg-border mx-0.5 hidden h-px w-4 sm:block" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
