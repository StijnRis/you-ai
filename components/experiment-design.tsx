"use client";

import { useState } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";
import { ChatPanel } from "@/components/chat-panel";
import { cn } from "@/lib/utils";

type MetricInfo = { key: string; label: string; days: number };

/**
 * Openers phrased around what this person actually tracks.
 *
 * A generic "design an experiment" gets a generic answer, because the model
 * has to guess what could even be measured. Naming their own best-covered
 * metrics up front means the first reply is already grounded in their data.
 */
function openersFor(metrics: MetricInfo[]): string[] {
  // Most days of data first: those are the ones with a usable baseline.
  const ranked = [...metrics].sort((a, b) => b.days - a.days);
  const names = ranked.slice(0, 3).map((metric) => metric.label.toLowerCase());

  const openers = [
    "Look at my data and suggest an experiment worth running.",
  ];
  if (names[0]) openers.push(`What could I change to improve my ${names[0]}?`);
  if (names[1]) openers.push(`Design a one-week experiment to improve my ${names[1]}.`);
  openers.push("I want to sleep better — find some evidence and set up an experiment.");
  openers.push("Would cold showers do anything for me? Set it up for a week.");
  return openers;
}

export function DesignChat({
  metrics,
  hasExperiments,
}: {
  metrics: MetricInfo[];
  hasExperiments: boolean;
}) {
  // Open by default for a first-time user, since there is nothing else on the
  // page; collapsed once they have experiments, since the list is the point.
  const [open, setOpen] = useState(!hasExperiments);

  return (
    <section className="rounded-xl border border-border">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FlaskConical className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Design an experiment with the AI</span>
          <span className="block text-sm text-muted">
            {metrics.length === 0
              ? "Import some data first — an experiment is judged on metrics you already track."
              : `Talk through what you want to improve. It reads your ${metrics.length} metrics, looks up the evidence, and sets the experiment up for you.`}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="border-t border-border p-4">
          <ChatPanel
            metrics={metrics}
            suggestions={openersFor(metrics)}
            emptyHint="Tell it what you want to improve, or start from one of these:"
          />
        </div>
      ) : null}
    </section>
  );
}
