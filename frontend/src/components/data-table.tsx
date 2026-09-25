"use client";
import { useState } from "react";
import { Check, Copy, Download, Loader2, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ENERGY_UNITS } from "@/components/energy-input";
import { RangeInput, rangeValid, type RangeState } from "@/components/spectrum-chart";
import { api, ApiError } from "@/lib/api";
import type { EnergyUnit, LengthUnit, MaterialInputState, ResultRow } from "@/lib/types";

/** XCOM-style number with a two-digit exponent: 7.1020E-02 */
const exp = (x: number, digits: number) => x.toExponential(digits).toUpperCase().replace(/E([+-])(\d)$/, "E$10$2");
const sci = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "" : exp(x, 4));

interface Col {
  key: string;
  label: string;
  unit: string;
  get: (r: ResultRow) => number | null | undefined;
}

const MASS_COLS: Col[] = [
  { key: "coh", label: "Coherent", unit: "cm²/g", get: (r) => r.mass_attenuation.coherent },
  { key: "incoh", label: "Incoherent", unit: "cm²/g", get: (r) => r.mass_attenuation.incoherent },
  { key: "pe", label: "Photoelectric", unit: "cm²/g", get: (r) => r.mass_attenuation.photoelectric },
  { key: "ppn", label: "Pair (nuclear)", unit: "cm²/g", get: (r) => r.mass_attenuation.pair_nuclear },
  { key: "ppe", label: "Pair (electron)", unit: "cm²/g", get: (r) => r.mass_attenuation.pair_electron },
  { key: "tot", label: "μ/ρ total, with coh.", unit: "cm²/g", get: (r) => r.mass_attenuation.total_with_coherent },
  { key: "totn", label: "μ/ρ total, w/o coh.", unit: "cm²/g", get: (r) => r.mass_attenuation.total_without_coherent },
];

function densityCols(lu: LengthUnit, withT: boolean): Col[] {
  const f = lu === "mm" ? 10 : lu === "m" ? 0.01 : lu === "um" ? 1e4 : 1;
  const cols: Col[] = [
    { key: "mu", label: "μ", unit: "cm⁻¹", get: (r) => r.shielding?.mu_cm_inv },
    { key: "hvl", label: "HVL", unit: lu, get: (r) => (r.shielding ? r.shielding.hvl_cm * f : null) },
    { key: "tvl", label: "TVL", unit: lu, get: (r) => (r.shielding ? r.shielding.tvl_cm * f : null) },
    { key: "mfp", label: "MFP", unit: lu, get: (r) => (r.shielding ? r.shielding.mfp_cm * f : null) },
  ];
  if (withT) {
    cols.push({ key: "t", label: "Transmission", unit: "%", get: (r) => (r.shielding?.transmission != null ? r.shielding.transmission * 100 : null) });
    cols.push({ key: "se", label: "Shielding eff.", unit: "%", get: (r) => r.shielding?.shielding_efficiency_percent });
  }
  return cols;
}

type TableRow = ResultRow & { edge?: string | null };

export function DataTable({
  material,
  ready,
  density,
  thickness,
}: {
  material: MaterialInputState;
  ready: boolean;
  density: { value: number; source: "database" | "user" | "estimate" } | null;
  thickness: { value: number; unit: LengthUnit } | null;
}) {
  const [mode, setMode] = useState<"grid" | "custom">("grid");
  const [range, setRange] = useState<RangeState>({ min: "1", minUnit: "keV", max: "100", maxUnit: "GeV" });
  const [custom, setCustom] = useState("");
  const [customUnit, setCustomUnit] = useState<EnergyUnit>("keV");
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [used, setUsed] = useState<{ density: number | null; thickness: typeof thickness; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const customValues = custom
    .split(/[\s,;]+/)
    .map((x) => parseFloat(x.replace(",", ".")))
    .filter((x) => Number.isFinite(x) && x > 0);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.table({
        material,
        density,
        thickness,
        ...(mode === "grid"
          ? { e_min: { value: parseFloat(range.min), unit: range.minUnit }, e_max: { value: parseFloat(range.max), unit: range.maxUnit } }
          : { energies: customValues.map((v) => ({ value: v, unit: customUnit })) }),
      });
      setRows(r.rows);
      setUsed({ density: r.density?.value ?? null, thickness, label: r.material.name ?? material.input });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not build the table.");
      setRows(null);
    } finally {
      setBusy(false);
    }
  };

  const cols: Col[] = [...MASS_COLS, ...(used?.density ? densityCols(used.thickness?.unit ?? "cm", !!used.thickness) : [])];

  const toDelimited = (sep: string) => {
    if (!rows || !used) return "";
    const head = ["Energy (MeV)", "Edge", ...cols.map((c) => `${c.label} (${c.unit})`)].join(sep);
    const body = rows.map((r) => [exp(r.energy_MeV, 6), r.edge ?? "", ...cols.map((c) => sci(c.get(r)))].join(sep)).join("\n");
    return head + "\n" + body + "\n";
  };

  const download = () => {
    const meta =
      `# Material: ${used?.label}\n# Data: NIST XCOM photon cross sections; mixture rule\n` +
      (used?.density ? `# Density: ${used.density} g/cm3\n` : "") +
      (used?.thickness ? `# Thickness: ${used.thickness.value} ${used.thickness.unit}\n` : "");
    const blob = new Blob([meta + toDelimited(",")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "attenuation_table.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toDelimited("\t"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Copying is not allowed by the browser; use Download CSV.");
    }
  };

  const canGenerate = ready && (mode === "grid" ? rangeValid(range) : customValues.length > 0);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Data table</CardTitle>
          <CardDescription>
            Partial and total mass attenuation coefficients{density ? ", μ, HVL, TVL and MFP" : " (enter a density above for μ, HVL, TVL, MFP)"} — like the NIST XCOM output table.
          </CardDescription>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as "grid" | "custom")}>
          <TabsList className="h-8">
            <TabsTrigger value="grid" className="text-xs">
              XCOM energy grid
            </TabsTrigger>
            <TabsTrigger value="custom" className="text-xs">
              My energies
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {mode === "grid" ? (
            <div className="space-y-1">
              <RangeInput range={range} onChange={setRange} />
              <p className="text-[11px] text-muted-foreground">Standard XCOM energies in this range, plus both sides of every absorption edge.</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-start gap-2">
              <Textarea
                className="min-h-10 max-w-xl flex-1 mono-num"
                rows={2}
                placeholder="e.g. 59.54, 122, 661.657, 1173.2, 1332.5"
                value={custom}
                aria-label="Energies"
                onChange={(e) => setCustom(e.target.value)}
              />
              <Select value={customUnit} onValueChange={(u) => setCustomUnit(u as EnergyUnit)}>
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
            </div>
          )}
          <Button onClick={generate} disabled={!canGenerate || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Table2 />} Generate table
          </Button>
          {rows && (
            <>
              <Button variant="outline" onClick={download}>
                <Download /> CSV
              </Button>
              <Button variant="outline" onClick={copy}>
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy for Excel"}
              </Button>
            </>
          )}
        </div>
        {!ready && <p className="text-xs text-muted-foreground">Enter a recognised material first.</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {rows && used && (
          <>
            <div className="max-h-[520px] overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                      Energy
                      <div className="font-normal">MeV</div>
                    </th>
                    {cols.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-right font-medium whitespace-nowrap text-muted-foreground">
                        {c.label}
                        <div className="font-normal">{c.unit}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="mono-num">
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-2 py-1 whitespace-nowrap">
                        {exp(r.energy_MeV, 4)}
                        {r.edge && <span className="ml-2 font-sans text-[10px] text-muted-foreground">{r.edge}</span>}
                      </td>
                      {r.available ? (
                        cols.map((c) => (
                          <td key={c.key} className={`px-2 py-1 text-right whitespace-nowrap ${c.key === "tot" ? "font-semibold" : ""}`}>
                            {sci(c.get(r))}
                          </td>
                        ))
                      ) : (
                        <td colSpan={cols.length} className="px-2 py-1 font-sans text-muted-foreground">
                          not available in the source data (just above an absorption edge)
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {rows.length} energies · {used.label}
              {used.density ? ` · ρ = ${used.density} g/cm³` : ""} · NIST XCOM, mixture rule · narrow-beam quantities.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
