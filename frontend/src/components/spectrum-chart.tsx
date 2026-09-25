"use client";
import { useEffect, useMemo, useState } from "react";
import type { Data, Layout, Shape } from "plotly.js";

type Annotation = NonNullable<Layout["annotations"]>[number];
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plot, CHART_COLORS } from "@/components/plot";
import { ENERGY_UNITS } from "@/components/energy-input";
import { api } from "@/lib/api";
import type { EnergyUnit, MaterialInputState, SpectrumData } from "@/lib/types";
import { cn } from "@/lib/utils";

export const CURVES = [
  { key: "total_with_coherent", label: "Total (with coherent)", color: CHART_COLORS[0], width: 2.5 },
  { key: "total_without_coherent", label: "Total (without coherent)", color: "#8b93a7", width: 1.5, dash: "dot" },
  { key: "photoelectric", label: "Photoelectric", color: CHART_COLORS[1], width: 1.5 },
  { key: "incoherent", label: "Compton (incoherent)", color: CHART_COLORS[2], width: 1.5 },
  { key: "coherent", label: "Coherent (Rayleigh)", color: CHART_COLORS[3], width: 1.5 },
  { key: "pair_total", label: "Pair production", color: CHART_COLORS[4], width: 1.5 },
] as const;

export interface RangeState {
  min: string;
  minUnit: EnergyUnit;
  max: string;
  maxUnit: EnergyUnit;
}

export function RangeInput({ range, onChange }: { range: RangeState; onChange: (r: RangeState) => void }) {
  const unitSel = (value: EnergyUnit, set: (u: EnergyUnit) => void, label: string) => (
    <Select value={value} onValueChange={(u) => set(u as EnergyUnit)}>
      <SelectTrigger className="w-20" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ENERGY_UNITS.map((u) => (
          <SelectItem key={u} value={u}>
            {u}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="mr-1">Energy range</Label>
      <Input className="w-24 num" value={range.min} aria-label="Minimum energy" onChange={(e) => onChange({ ...range, min: e.target.value })} />
      {unitSel(range.minUnit, (u) => onChange({ ...range, minUnit: u }), "Minimum energy unit")}
      <span className="text-muted-foreground">→</span>
      <Input className="w-24 num" value={range.max} aria-label="Maximum energy" onChange={(e) => onChange({ ...range, max: e.target.value })} />
      {unitSel(range.maxUnit, (u) => onChange({ ...range, maxUnit: u }), "Maximum energy unit")}
    </div>
  );
}

export function rangeValid(r: RangeState) {
  const a = parseFloat(r.min), b = parseFloat(r.max);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0;
}

export function edgeShapes(data: SpectrumData, maxEdges = 14): { shapes: Partial<Shape>[]; annotations: Partial<Annotation>[] } {
  // Show K and L edges (and M if few); label at top.
  const seen = new Set<string>();
  const edges = data.edges
    .filter((e) => /^(K|L[1-3])$/.test(e.label) || data.edges.length <= maxEdges)
    .filter((e) => {
      const k = `${e.element}-${e.label}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return {
    shapes: edges.map((e) => ({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: e.energy_MeV * 1000,
      x1: e.energy_MeV * 1000,
      y0: 0,
      y1: 1,
      line: { color: "rgba(140,140,160,0.45)", width: 1, dash: "dot" },
    })),
    annotations: edges
      .filter((e) => /^(K|L3)$/.test(e.label))
      .map((e, i) => ({
        x: Math.log10(e.energy_MeV * 1000),
        y: 1,
        xref: "x",
        yref: "paper",
        text: e.label === "L3" ? `${e.element} L` : `${e.element} ${e.label}`,
        showarrow: false,
        yanchor: "bottom",
        yshift: (i % 2) * 11,
        font: { size: 10, color: "#8b93a7" },
      })),
  };
}

export function SpectrumChart({
  material,
  range,
  markers = [],
  ready,
}: {
  material: MaterialInputState;
  range: RangeState;
  markers?: number[]; // MeV
  ready: boolean;
}) {
  const [data, setData] = useState<SpectrumData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState<Record<string, boolean>>({
    total_with_coherent: true,
    total_without_coherent: false,
    photoelectric: true,
    incoherent: true,
    coherent: true,
    pair_total: true,
  });
  const key = JSON.stringify([material, range]);

  useEffect(() => {
    if (!ready) setData(null);
    if (!ready || !rangeValid(range)) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .spectrum(material, { value: parseFloat(range.min), unit: range.minUnit }, { value: parseFloat(range.max), unit: range.maxUnit }, 400)
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  const plot = useMemo(() => {
    if (!data) return null;
    const x = data.energy_MeV.map((e) => e * 1000);
    const traces: Data[] = CURVES.filter((c) => visible[c.key]).map((c) => ({
      x,
      y: data.mass_attenuation[c.key].map((v) => (v && v > 0 ? v : null)),
      type: "scatter",
      mode: "lines",
      name: c.label,
      line: { color: c.color, width: c.width, dash: "dash" in c ? c.dash : undefined },
      connectgaps: false,
      hovertemplate: "%{y:.4g} cm²/g",
    }));
    const { shapes, annotations } = edgeShapes(data);
    for (const m of markers) {
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: m * 1000, x1: m * 1000, y0: 0, y1: 1, line: { color: CHART_COLORS[0], width: 1.2 } });
    }
    return { traces, shapes, annotations };
  }, [data, visible, markers]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {CURVES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setVisible({ ...visible, [c.key]: !visible[c.key] })}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
              visible[c.key] ? "bg-card text-foreground" : "text-muted-foreground opacity-60"
            )}
          >
            <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: c.color }} />
            {c.label}
          </button>
        ))}
        {loading && <Loader2 className="size-4 animate-spin self-center text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="h-[420px] w-full">
        {plot ? (
          <Plot
            className="h-full"
            data={plot.traces}
            layout={{
              xaxis: { type: "log", title: { text: "Photon energy (keV)" }, exponentformat: "power" },
              yaxis: { type: "log", title: { text: "μ/ρ (cm²/g)" }, exponentformat: "power" },
              shapes: plot.shapes,
              annotations: plot.annotations,
              margin: { l: 64, r: 16, t: 28, b: 48 },
            }}
          />
        ) : (
          <div className="grid h-full place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
            {ready ? "Choose an energy range" : "Enter a recognised material to see the attenuation spectrum"}
          </div>
        )}
      </div>
      {data && data.unavailable.length > 0 && (
        <p className="text-xs text-warning">
          Gaps: the photoelectric cross section is unavailable just above{" "}
          {data.unavailable.map((u) => `${u.element} ${u.edge} (${(u.from_MeV * 1000).toFixed(2)}–${(u.to_MeV * 1000).toFixed(0)} keV)`).join(", ")} in the source data;
          no values are interpolated there.
        </p>
      )}
    </div>
  );
}
