"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  CircleX,
  ExternalLink,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Formula, MaybeFormula } from "@/components/formula";
import { fmt } from "@/lib/format";
import type { CompositionData, Family, MaterialSummary, Resolution } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = {
  formula: "Chemical formula",
  material: "Material database",
  pubchem: "PubChem",
  composite: "Composite",
  manual: "User-edited",
  family: "Needs a preset",
};

/** Recognition checklist shown under the material input. */
export function RecognitionStatus({ resolution, loading, error }: { resolution: Resolution | null; loading: boolean; error: string | null }) {
  if (error)
    return (
      <p className="flex items-center gap-2 text-sm text-destructive">
        <CircleX className="size-4" /> {error}
      </p>
    );
  if (!resolution) return loading ? <p className="text-sm text-muted-foreground">Recognising…</p> : null;
  const ok = resolution.status === "resolved";
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {ok &&
        resolution.name && (
          <li className="flex items-center gap-1.5 font-medium">
            <Check className="size-4 text-success" />
            <span>
              <MaybeFormula text={resolution.formula && resolution.kind === "formula" ? resolution.formula : resolution.name} /> recognised
            </span>
          </li>
        )}
      {resolution.steps.slice(ok ? 0 : 0, 4).map((s, i) => (
        <li key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <Check className="size-3.5 text-success" /> {s}
        </li>
      ))}
      {resolution.status === "needs_choice" && (
        <li className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="size-4 text-warning" /> Choose a composition preset
        </li>
      )}
      {resolution.errors.map((e, i) => (
        <li key={i} className="flex items-center gap-1.5 text-destructive">
          <CircleX className="size-4" /> {e}
        </li>
      ))}
    </ul>
  );
}

function ElementTable({ comp, compact }: { comp: CompositionData; compact?: boolean }) {
  const total = comp.elements.reduce((s, e) => s + e.mass_fraction, 0);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-xs text-muted-foreground">
          <th className="py-1.5 text-left font-medium">Element</th>
          {!compact && <th className="py-1.5 text-right font-medium">Z</th>}
          {!compact && comp.elements.some((e) => e.atom_count) && <th className="py-1.5 text-right font-medium">Atoms</th>}
          <th className="py-1.5 text-right font-medium">wt%</th>
          <th className="w-1/3 py-1.5 pl-3" />
        </tr>
      </thead>
      <tbody className="mono-num">
        {comp.elements.map((e) => (
          <tr key={e.symbol} className="border-b border-border/60 last:border-0">
            <td className="py-1.5 font-sans">
              <span className="font-medium">{e.symbol}</span> <span className="text-xs text-muted-foreground">{e.name}</span>
            </td>
            {!compact && <td className="py-1.5 text-right text-muted-foreground">{e.Z}</td>}
            {!compact && comp.elements.some((x) => x.atom_count) && (
              <td className="py-1.5 text-right text-muted-foreground">{e.atom_count ? fmt(e.atom_count, 4) : ""}</td>
            )}
            <td className="py-1.5 text-right font-medium">{(e.mass_fraction * 100).toFixed(2)}</td>
            <td className="py-1.5 pl-3">
              <div className="h-1.5 rounded-full bg-muted">
                <div className="h-1.5 rounded-full bg-foreground/55" style={{ width: `${Math.max(1, e.mass_fraction * 100)}%` }} />
              </div>
            </td>
          </tr>
        ))}
        <tr className="text-xs text-muted-foreground">
          <td className="pt-2 font-sans">Total</td>
          {!compact && <td />}
          {!compact && comp.elements.some((e) => e.atom_count) && <td />}
          <td className="pt-2 text-right font-medium text-foreground">{(total * 100).toFixed(2)}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function CompositionEditor({
  initial,
  onApply,
  onCancel,
}: {
  initial: { symbol: string; percent: number }[];
  onApply: (c: Record<string, number>) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(initial.map((r) => ({ symbol: r.symbol, percent: String(Number(r.percent.toFixed(4))) })));
  const total = rows.reduce((s, r) => s + (parseFloat(r.percent) || 0), 0);
  const valid = Math.abs(total - 100) <= 0.5 && rows.every((r) => /^[A-Z][a-z]?$/.test(r.symbol) && parseFloat(r.percent) >= 0);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={r.symbol}
            aria-label="Element symbol"
            className="w-20"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, symbol: e.target.value.trim() } : x)))}
          />
          <Input
            value={r.percent}
            aria-label="Weight percent"
            inputMode="decimal"
            className="w-32 text-right mono-num"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
          />
          <span className="text-xs text-muted-foreground">wt%</span>
          <Button variant="ghost" size="icon" aria-label="Remove element" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { symbol: "", percent: "0" }])}>
          <Plus /> Element
        </Button>
        <span className={cn("text-sm mono-num", valid ? "text-success" : "text-destructive")}>Total {total.toFixed(2)} %</span>
        {!valid && <span className="text-xs text-muted-foreground">Must be 100 % (±0.5 %) with valid symbols</span>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => onApply(Object.fromEntries(rows.map((r) => [r.symbol, parseFloat(r.percent) || 0])))}
          >
            Use this composition
          </Button>
        </div>
      </div>
    </div>
  );
}

function PresetCard({ preset, onChoose }: { preset: MaterialSummary; onChoose: () => void }) {
  const top = preset.composition?.elements ?? [];
  return (
    <button
      type="button"
      onClick={onChoose}
      className="group flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-left transition-colors hover:border-foreground/30"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{preset.name}</span>
        {preset.formula && (
          <span className="text-xs text-muted-foreground">
            <Formula text={preset.formula} repeat={preset.repeat_unit} className="font-normal" />
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground mono-num">
        {top.map((e) => (
          <span key={e.symbol} className="rounded bg-muted px-1.5 py-0.5">
            {e.symbol} {(e.mass_fraction * 100).toFixed(2)}%
          </span>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        Density:{" "}
        {preset.density?.value ? (
          <span className="text-foreground">{preset.density.value} g/cm³</span>
        ) : (
          <span>not in database – enter your measured value</span>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">Source: {preset.composition_source}</div>
      {preset.notes && <div className="text-[11px] text-muted-foreground italic">{preset.notes}</div>}
    </button>
  );
}

export function FamilyChooser({
  family,
  label,
  onChoose,
  onCustom,
  onTemplate,
}: {
  family: Family;
  label?: string;
  onChoose: (presetId: string) => void;
  onCustom?: () => void;
  onTemplate?: (t: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg border bg-subtle p-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <div className="font-medium">
            {label ?? family.name}: composition preset required
          </div>
          <p className="text-xs text-muted-foreground">{family.warning}</p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {family.presets.map((p) => (
          <PresetCard key={p.id} preset={p} onChoose={() => onChoose(p.id)} />
        ))}
        {family.templates.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTemplate?.(t)}
            className="rounded-lg border border-dashed p-3 text-left text-sm hover:bg-accent/40"
          >
            <div className="font-medium">Composite template</div>
            <div className="text-xs text-muted-foreground">{t} — replace the fraction with your product&apos;s value</div>
          </button>
        ))}
        {onCustom && (
          <button type="button" onClick={onCustom} className="rounded-lg border border-dashed p-3 text-left text-sm hover:bg-accent/40">
            <div className="font-medium">Custom composition</div>
            <div className="text-xs text-muted-foreground">Enter the elemental composition of your formulation</div>
          </button>
        )}
      </div>
    </div>
  );
}

export function CompositionCard({
  resolution,
  onChoice,
  onManualComposition,
  onReplaceInput,
  manual,
}: {
  resolution: Resolution;
  onChoice: (key: string, presetId: string) => void;
  onManualComposition: (c: Record<string, number> | null) => void;
  onReplaceInput: (text: string) => void;
  manual: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showProv, setShowProv] = useState(false);
  const r = resolution;
  const comp = r.composition;
  const pendingComponents = useMemo(() => r.components.filter((c) => c.resolution.status === "needs_choice"), [r.components]);

  if (r.status === "not_found") {
    return (
      <Card className="border-destructive/30">
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 font-medium">
            <CircleX className="size-4 text-destructive" /> Material not found
          </div>
          <p className="text-sm text-muted-foreground">
            {r.errors[0]} No composition has been assumed. {r.warnings.join(" ")}
          </p>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="font-medium">Enter a chemical formula</div>
              <div className="text-xs text-muted-foreground">e.g. Bi2WO6, (C5H8O2)n, CuSO4·5H2O</div>
            </div>
            <Link href="/materials" className="rounded-lg border p-3 hover:bg-accent/40">
              <div className="font-medium">Search material database</div>
              <div className="text-xs text-muted-foreground">Polymers, NIST materials, elements</div>
            </Link>
            <Link href={`/materials?new=${encodeURIComponent(r.input)}`} className="rounded-lg border p-3 hover:bg-accent/40">
              <div className="font-medium">Create custom material</div>
              <div className="text-xs text-muted-foreground">Formula or elemental wt%</div>
            </Link>
          </div>
          {r.suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Did you mean:</span>
              {r.suggestions.slice(0, 6).map((s) => (
                <Button key={s.id} variant="outline" size="sm" onClick={() => onReplaceInput(s.name)}>
                  {s.name}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (r.status === "error") {
    return (
      <Card className="border-destructive/30">
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <CircleX className="size-4 text-destructive" /> Please correct the input
          </div>
          {r.errors.map((e, i) => (
            <p key={i} className="text-sm">
              {e}
            </p>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (r.status === "needs_choice") {
    if (r.family)
      return (
        <Card>
          <CardContent>
            {editing ? (
              <CompositionEditor
                initial={[{ symbol: "C", percent: 100 }]}
                onApply={(c) => {
                  onManualComposition(c);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <FamilyChooser
                family={r.family}
                onChoose={(id) => onChoice(r.input, id)}
                onCustom={() => setEditing(true)}
                onTemplate={(t) => onReplaceInput(t)}
              />
            )}
          </CardContent>
        </Card>
      );
    return (
      <Card>
        <CardContent className="space-y-4">
          <div className="text-sm font-medium">Composite recognised – choose presets for ambiguous components</div>
          <ComponentsList r={r} />
          {pendingComponents.map((c) =>
            c.resolution.family ? (
              <FamilyChooser
                key={c.text}
                family={c.resolution.family}
                label={`Component “${c.text}”`}
                onChoose={(id) => onChoice(c.text, id)}
              />
            ) : null
          )}
        </CardContent>
      </Card>
    );
  }

  if (!comp) return null;
  const isComposite = r.kind === "composite";
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="size-3.5 text-success" /> {isComposite ? "Composite recognised" : "Material recognised"}
            </div>
            <div className="mt-1 text-lg font-semibold">
              {r.kind === "formula" && r.formula ? <Formula text={r.formula} repeat={r.repeat_unit} /> : isComposite ? "Composite material" : r.name}
            </div>
            <div className="text-sm text-muted-foreground">
              {r.kind === "formula" && r.name !== r.formula && r.name}
              {r.kind !== "formula" && r.formula && <Formula text={r.formula} repeat={r.repeat_unit} className="font-normal" />}
              {r.pubchem && (
                <a href={r.pubchem.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 link">
                  PubChem CID {r.pubchem.cid} <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{manual ? "User-edited" : SOURCE_LABEL[r.kind ?? ""] ?? r.kind}</Badge>
            {r.material?.category && <Badge variant="outline">{r.material.category}</Badge>}
            {r.repeat_unit && <Badge variant="outline">repeat unit</Badge>}
          </div>
        </div>

        {comp.molar_mass && !isComposite && (
          <div className="flex gap-6 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{r.repeat_unit ? "Repeat-unit molar mass" : "Molar mass"}</div>
              <div className="font-medium mono-num">{comp.molar_mass.toFixed(2)} g/mol</div>
            </div>
          </div>
        )}

        {isComposite && <ComponentsList r={r} />}

        {editing ? (
          <CompositionEditor
            initial={comp.elements.map((e) => ({ symbol: e.symbol, percent: e.mass_fraction * 100 }))}
            onApply={(c) => {
              onManualComposition(c);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">{isComposite ? "Final elemental composition" : "Elemental composition"} (mass fractions)</div>
              <div className="flex gap-1">
                {manual && (
                  <Button variant="ghost" size="sm" onClick={() => onManualComposition(null)}>
                    <RotateCcw /> Reset
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
              </div>
            </div>
            <ElementTable comp={comp} />
          </div>
        )}

        {r.alternatives.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Info className="size-3.5" /> Also valid as:
            {r.alternatives.map((a) => (
              <Button key={a.input} variant="outline" size="sm" onClick={() => onReplaceInput(a.input)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}

        {r.warnings.length > 0 && (
          <ul className="space-y-1">
            {r.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" /> {w}
              </li>
            ))}
          </ul>
        )}

        <div>
          <button type="button" className="text-xs link" onClick={() => setShowProv(!showProv)}>
            {showProv ? "Hide" : "Show"} data provenance
          </button>
          {showProv && (
            <ul className="mt-2 space-y-1 text-xs">
              {r.provenance.map((p, i) => (
                <li key={i} className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-3">
                  <span className="text-muted-foreground">{p.item}</span>
                  <span>
                    {p.source}
                    {p.url && (
                      <a className="ml-1 text-muted-foreground hover:text-foreground" href={p.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="inline size-3" />
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ComponentsList({ r }: { r: Resolution }) {
  return (
    <div className="rounded-lg border">
      {r.components.map((c, i) => (
        <div key={i} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-0">
          <div className="min-w-0">
            <div className="truncate font-medium">
              {c.resolution.kind === "formula" && c.resolution.formula ? (
                <Formula text={c.resolution.formula} repeat={c.resolution.repeat_unit} />
              ) : (
                c.resolution.name ?? c.text
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {c.role && `${c.role} · `}
              {c.resolution.status === "needs_choice" ? "preset required" : SOURCE_LABEL[c.resolution.kind ?? ""] ?? c.resolution.kind}
            </div>
          </div>
          <div className="text-right mono-num">
            <div className="font-medium">{(c.mass_percent ?? c.percent).toFixed(2)} wt%</div>
            {c.basis === "vol" && <div className="text-xs text-muted-foreground">{c.percent.toFixed(2)} vol%</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
