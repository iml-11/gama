"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Data } from "plotly.js";
import { Loader2, Plus, Trash2, GitCompareArrows } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { MaterialInput } from "@/components/material-input";
import { FamilyChooser } from "@/components/composition-card";
import { Formula } from "@/components/formula";
import { Plot, CHART_COLORS } from "@/components/plot";
import { RangeInput, rangeValid, edgeShapes, type RangeState } from "@/components/spectrum-chart";
import { ENERGY_UNITS } from "@/components/energy-input";
import { useResolution } from "@/hooks/use-resolution";
import { api, ApiError } from "@/lib/api";
import { fmt, fmtEnergy } from "@/lib/format";
import type { EnergyUnit, LengthUnit, MaterialInputState, Resolution } from "@/lib/types";

interface Row {
  id: number;
  material: MaterialInputState;
  density: string;
}

type CompareResult = Awaited<ReturnType<typeof api.compare>>;

function MaterialRow({
  row,
  index,
  onChange,
  onRemove,
  onResolved,
}: {
  row: Row;
  index: number;
  onChange: (r: Row) => void;
  onRemove: () => void;
  onResolved: (id: number, r: Resolution | null) => void;
}) {
  const { resolution, loading, current } = useResolution(row.material);
  const status = resolution?.status;
  // Report resolution up (enables the Compare button); stale results count as unresolved.
  useEffect(() => onResolved(row.id, current ? resolution : null), [resolution, current, row.id, onResolved]);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
        <div className="flex-1">
          <MaterialInput
            size="sm"
            value={row.material.input}
            loading={loading}
            placeholder="e.g. Pb, WO3, 60% Bi2WO6 + 40% epoxy"
            onChange={(v) => onChange({ ...row, material: { ...row.material, input: v, composition: null } })}
          />
        </div>
        <Input
          className="w-24 text-right num"
          inputMode="decimal"
          placeholder="ρ g/cm³"
          aria-label="Density"
          value={row.density}
          onChange={(e) => onChange({ ...row, density: e.target.value })}
        />
        <Button variant="ghost" size="icon" aria-label="Remove material" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5 text-xs text-muted-foreground">
        {status === "resolved" && (
          <>
            <Badge variant="success">recognised</Badge>
            {resolution!.kind === "formula" && resolution!.formula ? <Formula text={resolution!.formula} className="font-normal" /> : resolution!.name}
            {resolution!.density?.value && !row.density && (
              <button type="button" className="text-primary hover:underline" onClick={() => onChange({ ...row, density: String(resolution!.density!.value) })}>
                use database density {resolution!.density.value} g/cm³
              </button>
            )}
          </>
        )}
        {status === "not_found" && <Badge variant="destructive">not found</Badge>}
        {status === "error" && <span className="text-destructive">{resolution!.errors[0]}</span>}
      </div>
      {status === "needs_choice" && (
        <div className="pl-5">
          {resolution!.family ? (
            <FamilyChooser family={resolution!.family} onChoose={(id) => onChange({ ...row, material: { ...row.material, choices: { ...row.material.choices, [resolution!.input]: id } } })} />
          ) : (
            resolution!.components
              .filter((c) => c.resolution.family)
              .map((c) => (
                <FamilyChooser
                  key={c.text}
                  family={c.resolution.family!}
                  label={`Component “${c.text}”`}
                  onChoose={(id) => onChange({ ...row, material: { ...row.material, choices: { ...row.material.choices, [c.text]: id } } })}
                />
              ))
          )}
        </div>
      )}
    </div>
  );
}

const DEFAULTS = ["Bi2WO6", "Pb", "WO3", "Bi2O3", "60 wt% Bi2WO6 + 40 wt% epoxy"];

export default function ComparePage() {
  const [rows, setRows] = useState<Row[]>(DEFAULTS.map((m, i) => ({ id: i, material: { input: m, choices: {} }, density: m === "Pb" ? "11.35" : "" })));
  const [resolved, setResolved] = useState<Record<number, Resolution | null>>({});
  const [range, setRange] = useState<RangeState>({ min: "10", minUnit: "keV", max: "10", maxUnit: "MeV" });
  const [energy, setEnergy] = useState({ value: "661.657", unit: "keV" as EnergyUnit });
  const [thickness, setThickness] = useState({ value: "1", unit: "cm" as LengthUnit });
  const [quantity, setQuantity] = useState<"mu_rho" | "mu">("mu_rho");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onResolved = useCallback((id: number, r: Resolution | null) => {
    setResolved((prev) => (prev[id] === r ? prev : { ...prev, [id]: r }));
  }, []);

  const allResolved = rows.length > 0 && rows.every((r) => resolved[r.id]?.status === "resolved");

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const ev = parseFloat(energy.value);
      const r = await api.compare({
        items: rows.map((r) => {
          const d = parseFloat(r.density);
          return { material: r.material, density: Number.isFinite(d) && d > 0 ? { value: d, source: "user" } : null };
        }),
        energies: Number.isFinite(ev) && ev > 0 ? [{ value: ev, unit: energy.unit }] : [],
        e_min: rangeValid(range) ? { value: parseFloat(range.min), unit: range.minUnit } : undefined,
        e_max: rangeValid(range) ? { value: parseFloat(range.max), unit: range.maxUnit } : undefined,
        thickness: parseFloat(thickness.value) >= 0 ? { value: parseFloat(thickness.value), unit: thickness.unit } : null,
      });
      setResult(r);
      if (!r.linear_comparable) setQuantity("mu_rho");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  };

  const traces: Data[] = useMemo(() => {
    if (!result) return [];
    return result.items.map((it, i) => ({
      x: it.spectrum!.energy_MeV.map((e) => e * 1000),
      y: it.spectrum!.mass_attenuation.total_with_coherent.map((v) => (v ? (quantity === "mu" ? v * (it.density?.value ?? NaN) : v) : null)),
      type: "scatter",
      mode: "lines",
      name: it.label,
      line: { color: CHART_COLORS[i % CHART_COLORS.length], width: 2 },
      hovertemplate: `%{y:.4g} ${quantity === "mu" ? "cm⁻¹" : "cm²/g"}`,
    }));
  }, [result, quantity]);

  const shapes = useMemo(() => {
    if (!result?.items[0]?.spectrum) return { shapes: [], annotations: [] };
    // Edges of all materials
    const all = { ...result.items[0].spectrum, edges: result.items.flatMap((i) => i.spectrum?.edges ?? []).filter((e) => e.label === "K" || e.label === "L3") };
    return edgeShapes(all, 0);
  }, [result]);

  const tUnit = thickness.unit;
  const lf = tUnit === "mm" ? 10 : tUnit === "m" ? 0.01 : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare materials</h1>
        <p className="text-sm text-muted-foreground">
          Up to 8 materials on one graph. Linear quantities (μ, HVL, TVL, transmission) are only compared when every material has a density.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Materials</CardTitle>
            <CardDescription>Density is optional (g/cm³).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((r, i) => (
              <MaterialRow
                key={r.id}
                row={r}
                index={i}
                onResolved={onResolved}
                onChange={(nr) => setRows(rows.map((x) => (x.id === r.id ? nr : x)))}
                onRemove={() => setRows(rows.filter((x) => x.id !== r.id))}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={rows.length >= 8}
              onClick={() => setRows([...rows, { id: Math.max(-1, ...rows.map((r) => r.id)) + 1, material: { input: "", choices: {} }, density: "" }])}
            >
              <Plus /> Add material
            </Button>
            <div className="space-y-3 border-t pt-3">
              <RangeInput range={range} onChange={setRange} />
              <div className="flex flex-wrap items-center gap-2">
                <Label className="mr-1">Table energy</Label>
                <Input className="w-28 num" value={energy.value} aria-label="Energy" onChange={(e) => setEnergy({ ...energy, value: e.target.value })} />
                <Select value={energy.unit} onValueChange={(u) => setEnergy({ ...energy, unit: u as EnergyUnit })}>
                  <SelectTrigger className="w-20" aria-label="Energy unit">
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
                <Label className="mr-1 ml-2">Thickness</Label>
                <Input className="w-20 num" value={thickness.value} aria-label="Thickness" onChange={(e) => setThickness({ ...thickness, value: e.target.value })} />
                <Select value={thickness.unit} onValueChange={(u) => setThickness({ ...thickness, unit: u as LengthUnit })}>
                  <SelectTrigger className="w-20" aria-label="Thickness unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["mm", "cm", "m"] as const).map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" disabled={!allResolved || busy} onClick={run}>
              {busy ? <Loader2 className="animate-spin" /> : <GitCompareArrows />} Compare
            </Button>
            {!allResolved && <p className="text-center text-xs text-muted-foreground">All materials must be recognised (choose presets where asked).</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{quantity === "mu" ? "Linear attenuation coefficient μ" : "Mass attenuation coefficient μ/ρ"} (with coherent)</CardTitle>
              <Tabs value={quantity} onValueChange={(v) => setQuantity(v as "mu" | "mu_rho")}>
                <TabsList className="h-8">
                  <TabsTrigger value="mu_rho" className="text-xs">
                    μ/ρ
                  </TabsTrigger>
                  <TabsTrigger value="mu" className="text-xs" disabled={!result?.linear_comparable}>
                    μ
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <div className="h-[440px]">
                {result ? (
                  <Plot
                    className="h-full"
                    data={traces}
                    layout={{
                      xaxis: { type: "log", title: { text: "Photon energy (keV)" }, exponentformat: "power" },
                      yaxis: { type: "log", title: { text: quantity === "mu" ? "μ (cm⁻¹)" : "μ/ρ (cm²/g)" }, exponentformat: "power" },
                      shapes: shapes.shapes,
                      annotations: shapes.annotations,
                      margin: { l: 64, r: 16, t: 28, b: 48 },
                    }}
                  />
                ) : (
                  <div className="grid h-full place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Press Compare</div>
                )}
              </div>
              {result?.note && <p className="mt-2 text-xs text-warning">{result.note}</p>}
            </CardContent>
          </Card>
          {result && result.items[0]?.at_energies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>At {fmtEnergy(result.items[0].at_energies[0].energy_MeV)}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>μ/ρ (cm²/g)</TableHead>
                      {result.linear_comparable && (
                        <>
                          <TableHead>ρ (g/cm³)</TableHead>
                          <TableHead>μ (cm⁻¹)</TableHead>
                          <TableHead>HVL ({tUnit})</TableHead>
                          <TableHead>TVL ({tUnit})</TableHead>
                          <TableHead>Transmission ({thickness.value} {tUnit})</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody className="num">
                    {result.items.map((it, i) => {
                      const r = it.at_energies[0];
                      const s = r.shielding;
                      return (
                        <TableRow key={i}>
                          <TableCell className="flex items-center gap-2">
                            <span className="size-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                            {it.label}
                          </TableCell>
                          <TableCell>{fmt(r.mass_attenuation.total_with_coherent)}</TableCell>
                          {result.linear_comparable && (
                            <>
                              <TableCell>{it.density?.value}</TableCell>
                              <TableCell>{fmt(s?.mu_cm_inv)}</TableCell>
                              <TableCell>{s ? fmt(s.hvl_cm * lf) : "—"}</TableCell>
                              <TableCell>{s ? fmt(s.tvl_cm * lf) : "—"}</TableCell>
                              <TableCell>{s?.transmission != null ? `${fmt(s.transmission * 100)} %` : "—"}</TableCell>
                            </>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
