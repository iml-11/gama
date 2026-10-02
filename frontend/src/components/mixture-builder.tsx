"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CircleX, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialInput } from "@/components/material-input";
import { Formula } from "@/components/formula";
import { useResolution } from "@/hooks/use-resolution";
import type { Resolution } from "@/lib/types";
import { cn } from "@/lib/utils";

export type MixBasis = "wt" | "vol";

interface Comp {
  id: number;
  text: string; // what the user added
  preset: string | null; // chosen composition preset id (epoxy, concrete, ...)
}

/** Best-effort reading of an existing expression when the builder opens. */
function parseMixture(expr: string): { comps: Comp[]; pct: Record<number, string>; basis: MixBasis } {
  const basis: MixBasis = /vol\s*%/i.test(expr) ? "vol" : "wt";
  const parts = expr.split("+").map((p) => p.trim()).filter(Boolean);
  const comps: Comp[] = [];
  const pct: Record<number, string> = {};
  parts.forEach((p, i) => {
    const m = p.match(/^(\d+(?:\.\d+)?)\s*(?:wt|vol|mass|weight)?\.?\s*%\s*(.+)$/i);
    comps.push({ id: i, text: m ? m[2].trim() : p, preset: null });
    if (m) pct[i] = m[1];
  });
  return { comps, pct, basis };
}

const round = (x: number) => Number(x.toFixed(4)).toString();

/** One added component: shows what it was recognised as, or asks for a preset. */
function ComponentCard({
  comp,
  index,
  onPreset,
  onRemove,
  onStatus,
}: {
  comp: Comp;
  index: number;
  onPreset: (id: string) => void;
  onRemove: () => void;
  onStatus: (id: number, r: Resolution | null, ready: boolean) => void;
}) {
  const { resolution: r, loading, current } = useResolution({ input: comp.preset ?? comp.text, choices: {} }, 150);
  useEffect(() => onStatus(comp.id, r, current && r?.status === "resolved"), [r, current, comp.id, onStatus]);

  const family = r?.status === "needs_choice" ? r.family : null;
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-medium mono-num">{index + 1}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">
            {r?.status === "resolved" && r.kind === "formula" && r.formula ? <Formula text={r.formula} /> : r?.status === "resolved" ? r.name : comp.text}
          </span>
          {r?.status === "resolved" && r.kind !== "formula" && r.formula && (
            <span className="text-xs text-muted-foreground">
              <Formula text={r.formula} repeat={r.repeat_unit} className="font-normal" />
            </span>
          )}
          {r?.status === "resolved" && r.category && <span className="text-xs text-muted-foreground">· {r.category}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {loading || !current ? (
            <>
              <Loader2 className="size-3 animate-spin" /> recognising…
            </>
          ) : r?.status === "resolved" ? (
            <>
              <Check className="size-3.5 text-success" /> recognised
              {comp.preset && <span>· preset chosen by you</span>}
            </>
          ) : family ? (
            <>
              <AlertTriangle className="size-3.5 text-warning" /> {family.name} has no single composition – choose one:
            </>
          ) : (
            <>
              <CircleX className="size-3.5 text-destructive" /> {r?.errors[0] ?? "not recognised"} Remove it and enter a formula or another name.
            </>
          )}
        </div>
        {(family || comp.preset) && (
          <Select value={comp.preset ?? ""} onValueChange={onPreset}>
            <SelectTrigger className="h-8 max-w-md text-xs" aria-label={`Composition preset for ${comp.text}`}>
              <SelectValue placeholder="Choose a composition preset" />
            </SelectTrigger>
            <SelectContent>
              {(family?.presets ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
              {!family && comp.preset && (
                <SelectItem value={comp.preset} className="text-xs">
                  {r?.name ?? comp.preset}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>
      <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove ${comp.text}`} onClick={onRemove}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

/**
 * Two-step mixture editor.
 *  1. Add components one at a time (any name, formula, polymer, element or custom material).
 *  2. Set their ratios (wt% or vol%); the last component can take the remainder.
 * Emits a composite expression only when every component is recognised and the ratios add up.
 */
export function MixtureBuilder({ initial, onChange, compact }: { initial: string; onChange: (expr: string) => void; compact?: boolean }) {
  const init = useMemo(() => parseMixture(initial), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [comps, setComps] = useState<Comp[]>(init.comps);
  const [pct, setPct] = useState<Record<number, string>>(init.pct);
  const [basis, setBasis] = useState<MixBasis>(init.basis);
  const [autoLast, setAutoLast] = useState(true);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState<Record<number, boolean>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const nextId = useRef(init.comps.length);

  const onStatus = useMemo(
    () => (id: number, r: Resolution | null, ok: boolean) => {
      setReady((prev) => (prev[id] === ok ? prev : { ...prev, [id]: ok }));
      const label = ok && r ? (r.kind === "formula" && r.formula ? r.formula : r.name ?? "") : "";
      if (label) setNames((prev) => (prev[id] === label ? prev : { ...prev, [id]: label }));
    },
    []
  );

  const add = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setComps((c) => [...c, { id: nextId.current++, text: t, preset: null }]);
    setQuery("");
  };
  const remove = (id: number) => {
    setComps((c) => c.filter((x) => x.id !== id));
    setPct((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
  };

  // Ratios: with autoLast the last component takes 100 − (sum of the others).
  const last = comps[comps.length - 1];
  const others = comps.slice(0, -1);
  const sumOthers = others.reduce((s, c) => s + (parseFloat(pct[c.id]) || 0), 0);
  const values: Record<number, number> = {};
  comps.forEach((c) => (values[c.id] = parseFloat(pct[c.id]) || 0));
  if (autoLast && last && comps.length > 1) values[last.id] = 100 - sumOthers;
  const total = comps.reduce((s, c) => s + values[c.id], 0);
  const anyNonPositive = comps.length > 1 && comps.some((c) => !(values[c.id] > 0));
  const touched = comps.some((c) => (pct[c.id] ?? "").trim() !== "");
  const ratiosOk = comps.length <= 1 || (Math.abs(total - 100) <= 0.01 && !anyNonPositive);
  const allReady = comps.length > 0 && comps.every((c) => ready[c.id]);

  const expr = useMemo(() => {
    if (!allReady || !ratiosOk) return "";
    if (comps.length === 1) return comps[0].preset ?? comps[0].text;
    return comps.map((c) => `${round(values[c.id])} ${basis}% ${c.preset ?? c.text}`).join(" + ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReady, ratiosOk, comps, basis, JSON.stringify(values)]);

  useEffect(() => {
    onChange(expr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr]);

  return (
    <div className={cn("grid gap-4 rounded-lg border bg-card p-4", !compact && "lg:grid-cols-2")}>
      {/* Step 1 */}
      <section className="space-y-3">
        <div>
          <div className="text-sm font-medium">1 · Add components</div>
          <div className="text-xs text-muted-foreground">One at a time: a filler (e.g. Bi2WO6, W, lead oxide), then the matrix (e.g. epoxy, PMMA, silicone)…</div>
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <MaterialInput size="sm" value={query} onChange={setQuery} onPick={add} placeholder="Search or type a formula, then Enter" />
          </div>
          <Button variant="outline" size="sm" className="h-9" disabled={!query.trim()} onClick={() => add(query)}>
            <Plus /> Add
          </Button>
        </div>
        <div className="space-y-2">
          {comps.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">No components yet.</p>}
          {comps.map((c, i) => (
            <ComponentCard
              key={c.id}
              comp={c}
              index={i}
              onStatus={onStatus}
              onRemove={() => remove(c.id)}
              onPreset={(id) => setComps((cs) => cs.map((x) => (x.id === c.id ? { ...x, preset: id } : x)))}
            />
          ))}
        </div>
      </section>

      {/* Step 2 */}
      <section className={cn("space-y-3", compact ? "border-t pt-4" : "lg:border-l lg:pl-4")}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">2 · Set the ratios</div>
            <div className="text-xs text-muted-foreground">By weight (wt%) or by volume (vol%, needs densities).</div>
          </div>
          <Tabs value={basis} onValueChange={(v) => setBasis(v as MixBasis)}>
            <TabsList className="h-8">
              <TabsTrigger value="wt" className="text-xs">
                wt%
              </TabsTrigger>
              <TabsTrigger value="vol" className="text-xs">
                vol%
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {comps.length < 2 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            {comps.length === 0 ? "Add at least two components to set a ratio." : "One component = a single material. Add another to make a mixture."}
          </p>
        ) : (
          <div className="space-y-3">
            {comps.map((c, i) => {
              const isAuto = autoLast && c.id === last.id;
              const v = values[c.id];
              return (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      <span className="mr-1.5 text-muted-foreground mono-num">{i + 1}</span>
                      {names[c.id] ?? c.text}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="h-8 w-24 text-right mono-num"
                        inputMode="decimal"
                        aria-label={`Fraction of ${c.text}`}
                        disabled={isAuto}
                        value={isAuto ? round(v) : pct[c.id] ?? ""}
                        placeholder="0"
                        onChange={(e) => setPct({ ...pct, [c.id]: e.target.value })}
                      />
                      <span className="w-8 text-muted-foreground">{basis}%</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    disabled={isAuto}
                    aria-label={`Slider for ${c.text}`}
                    value={Math.max(0, Math.min(100, v))}
                    onChange={(e) => setPct({ ...pct, [c.id]: e.target.value })}
                    className="w-full accent-foreground disabled:opacity-40"
                  />
                </div>
              );
            })}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={autoLast} onChange={(e) => setAutoLast(e.target.checked)} className="accent-foreground" />
              Last component takes the remainder
            </label>
            <div className={cn("flex items-center justify-between border-t pt-2 text-sm", !ratiosOk && touched && "text-destructive")}>
              <span>Total</span>
              <span className="mono-num">{round(total)} %</span>
            </div>
            {!ratiosOk && !touched && <p className="text-xs text-muted-foreground">Enter the fraction of each component (or move the sliders).</p>}
            {!ratiosOk && touched && (
              <p className="text-xs text-destructive">
                {anyNonPositive ? "Every component needs a fraction above 0 %." : `Fractions add up to ${round(total)} %. They must total 100 %.`}
              </p>
            )}
          </div>
        )}
        {comps.length > 0 && !allReady && <p className="text-xs text-muted-foreground">Waiting for every component to be recognised (choose presets where asked).</p>}
      </section>
    </div>
  );
}
