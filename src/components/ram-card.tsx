"use client";

import * as React from "react";
import { Check, Copy, Info, MemoryStick, Monitor, Server } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import type { RamEstimate } from "@/lib/core/types";

export function RamCard({ ram }: { ram: RamEstimate }) {
  const [copied, setCopied] = React.useState(false);

  function copyArgs() {
    navigator.clipboard.writeText(ram.jvmArgs).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MemoryStick className="text-primary size-4" />
          Memoire recommandee
        </CardTitle>
        <CardDescription>
          Estimee a partir de la version de Minecraft, du nombre de mods et de ceux qui pesent
          particulierement lourd ou, au contraire, optimisent la memoire.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure
            icon={<Monitor className="size-4" />}
            label="Client"
            value={`${ram.clientGb} Go`}
            highlight
          />
          <Figure
            icon={<Server className="size-4" />}
            label="Serveur dedie"
            value={`${ram.serverGb} Go`}
          />
          <Figure
            icon={<Info className="size-4" />}
            label="Minimum"
            value={`${ram.minimumGb} Go`}
            hint="en dessous, demarrage incertain"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Arguments JVM</p>
            <Button variant="ghost" size="sm" onClick={copyArgs}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copie" : "Copier"}
            </Button>
          </div>
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 font-mono text-[11.5px] leading-relaxed">
            {ram.jvmArgs}
          </pre>
        </div>

        <Separator />

        <Accordion type="single" collapsible>
          <AccordionItem value="detail" className="border-b-0">
            <AccordionTrigger className="py-0 text-sm">
              Comment ce chiffre est calcule
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              <ul className="space-y-2">
                {ram.breakdown.map((b, i) => (
                  <li key={i} className="flex items-baseline gap-3 text-sm">
                    <span
                      className={`w-16 shrink-0 text-right font-mono text-xs ${
                        b.gb < 0 ? "text-success" : "text-muted-foreground"
                      }`}
                    >
                      {b.gb >= 0 ? "+" : ""}
                      {b.gb} Go
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{b.label}</span>
                      <span className="text-muted-foreground"> — {b.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <ul className="text-muted-foreground space-y-1.5 text-xs">
          {ram.notes.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-muted-foreground/60">
                •
              </span>
              <span className="text-pretty">{n}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Figure({
  icon,
  label,
  value,
  hint,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${highlight ? "border-primary/40 bg-primary/5" : ""}`}
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${highlight ? "text-primary" : ""}`}>
        {value}
      </div>
      {hint && <div className="text-muted-foreground mt-0.5 text-[11px]">{hint}</div>}
    </div>
  );
}
