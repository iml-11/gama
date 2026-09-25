"use client";
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialInput } from "@/components/material-input";
import { cn } from "@/lib/utils";

export interface MixRow {
  text: string;
  pct: string;
}

export type MixBasis = "wt" | "vol";

/** Build the composite expression understood by the backend resolver. */
export function mixtureExpression(rows: MixRow[], basis: MixBasis): string {
  const used = rows.filter((r) => r.text.trim());
  if (used.length === 1) return used[0].text.trim();
  return used.map((r) => (r.pct.trim() ? `${r.pct.trim()} ${basis}% ${r.text.trim()}` : r.text.trim())).join(" + ");
}

/** Best-effort reverse of mixtureExpression, used when switching into the builder. */
export function parseMixture(expr: string): { rows: MixRow[]; basis: MixBasis } {
  const basis: MixBasis = /vol\s*%/i.test(expr) ? "vol" : "wt";
  const parts = expr.split("+").map((p) => p.trim()).filter(Boolean);
  const rows = parts.map((p) => {
    const m = p.match(/^(\d+(?:\.\d+)?)\s*(?:wt|vol|mass|weight)?\.?\s*%\s*(.+)$/i);
    return m ? { text: m[2].trim(), pct: m[1] } : { text: p, pct: "" };
  });
  while (rows.length < 2) rows.push({ text: "", pct: "" });
  return { rows, basis };
}

/**
 * Free mixture editor: any number of components (names, formulas, polymers,
 * elements, custom materials) with user-chosen weight or volume percentages.
 */
export function MixtureBuilder({ initial, onChange }: { initial: string; onChange: (expr: string) => void }) {
  const [state, setState] = useState(() => parseMixture(initial));
  const { rows, basis } = state;

  useEffect(() => {
    onChange(mixtureExpression(rows, basis));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, basis]);

  const setRows = (r: MixRow[]) => setState({ ...state, rows: r });
  const filled = rows.filter((r) => r.text.trim());
  const blanks = filled.filter((r) => !r.pct.trim());
  const nums = filled.map((r) => parseFloat(r.pct)).filter((x) => Number.isFinite(x));
  const total = nums.reduce((a, b) => a + b, 0);
  const remainder = blanks.length === 1 ? 100 - total : null;
  const ok = blanks.length === 0 ? Math.abs(total - 100) <= 0.01 : blanks.length === 1 && remainder !== null && remainder > 0;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Mixture components</div>
          <div className="text-xs text-muted-foreground">Any material, formula, polymer, element or custom material, in any ratio.</div>
        </div>
        <Tabs value={basis} onValueChange={(v) => setState({ ...state, basis: v as MixBasis })}>
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

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-4 text-right text-xs text-muted-foreground mono-num">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <MaterialInput
                size="sm"
                value={r.text}
                placeholder={i === 0 ? "e.g. Bi2WO6, tungsten, lead oxide" : "e.g. PMMA, epoxy, silicone, water"}
                onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, text: v } : x)))}
              />
            </div>
            <Input
              className="w-24 text-right mono-num"
              inputMode="decimal"
              aria-label={`Fraction of component ${i + 1}`}
              placeholder={remainder !== null && !r.pct.trim() && r.text.trim() ? remainder.toFixed(2) : "%"}
              value={r.pct}
              onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
            />
            <span className="w-9 text-xs text-muted-foreground">{basis}%</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove component"
              disabled={rows.length <= 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { text: "", pct: "" }])}>
          <Plus /> Add component
        </Button>
        {filled.length >= 2 && (
          <span className={cn("text-sm mono-num", ok ? "text-foreground" : "text-destructive")}>
            Total {(remainder !== null && remainder > 0 ? 100 : total).toFixed(2)} %
            {remainder !== null && remainder > 0 && <span className="ml-1 font-sans text-xs text-muted-foreground">(empty field = remainder {remainder.toFixed(2)} %)</span>}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Leave one fraction empty to fill it with the remainder. vol% requires a density for every component (from the database or a custom material).
      </p>
    </div>
  );
}
