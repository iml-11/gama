"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Data } from "plotly.js";
import { Download, FlaskConical, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MaterialInput } from "@/components/material-input";
import { MixtureBuilder } from "@/components/mixture-builder";
import { CompositionCard, RecognitionStatus } from "@/components/composition-card";
import { DensityInput, type DensityState } from "@/components/density-input";
import { ENERGY_UNITS } from "@/components/energy-input";
import { Plot, useDark } from "@/components/plot";
import { useResolution } from "@/hooks/use-resolution";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { EnergyUnit, MaterialInputState, SpectrumData } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Pt {
  energy: string;
  mu: string;
  mu_rho: string;
  unc: string;
}

type ExpResult = Awaited<ReturnType<typeof api.experimental>>;

const EMPTY: Pt = { energy: "", mu: "", mu_rho: "", unc: "" };

/** Minimal CSV parser: header row with energy, mu and/or mu_rho (and optional uncertainty). */
function parseCsv(text: string): { rows: Pt[]; error: string | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return { rows: [], error: "CSV needs a header row and at least one data row." };
  const sep = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/[\s()]/g, ""));
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const iE = find("energy");
  const iMu = header.findIndex((h) => /^(mu|μ)(_?exp)?(\[?1\/cm\]?|cm-1)?$/.test(h) || h === "mu_cm-1" || h === "linear");
  const iMr = header.findIndex((h) => /^(mu_?rho|mu\/rho|μ\/ρ|mass)/.test(h));
  const iU = find("unc", "uncertainty", "err", "sigma");
  if (iE < 0 || (iMu < 0 && iMr < 0)) return { rows: [], error: "Header must contain 'energy' and 'mu' and/or 'mu_rho' columns." };
  const rows = lines.slice(1).map((l) => {
    const c = l.split(sep).map((x) => x.trim());
    return { energy: c[iE] ?? "", mu: iMu >= 0 ? c[iMu] ?? "" : "", mu_rho: iMr >= 0 ? c[iMr] ?? "" : "", unc: iU >= 0 ? c[iU] ?? "" : "" };
  });
  return { rows, error: null };
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ExperimentalPage() {
  const [material, setMaterial] = useState<MaterialInputState>({ input: "", choices: {}, composition: null });
  const { resolution, loading, error, current } = useResolution(material);
  const [density, setDensity] = useState<DensityState>({ value: "", source: "user" });
  const [unit, setUnit] = useState<EnergyUnit>("keV");
  const [pts, setPts] = useState<Pt[]>([
    { ...EMPTY },
    { ...EMPTY },
    { ...EMPTY },
  ]);
  const [result, setResult] = useState<ExpResult | null>(null);
  const [curve, setCurve] = useState<SpectrumData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mixing, setMixing] = useState(false);
  const dark = useDark();
  const ink = dark ? "#fafafa" : "#18181b";
  const soft = dark ? "#a1a1aa" : "#71717a";

  const suggested = resolution?.status === "resolved" ? resolution.density : null;
  const identity = resolution?.status === "resolved" && current ? JSON.stringify([resolution.name, resolution.composition?.elements.map((e) => [e.symbol, e.mass_fraction.toFixed(6)])]) : null;
  const lastIdentity = useRef<string | null>(null);
  // A new input that is not (yet) a recognised material: forget the old density.
  const unresolvedNow = current && !!resolution && resolution.status !== "resolved";
  useEffect(() => {
    if (!unresolvedNow) return;
    lastIdentity.current = null;
    setDensity({ value: "", source: "user" });
  }, [unresolvedNow]);
  useEffect(() => {
    // Manual edits of the composition keep the current density.
    if (!identity || identity === lastIdentity.current || resolution?.kind === "manual") return;
    lastIdentity.current = identity;
    setDensity(suggested?.value ? { value: String(suggested.value), source: "database" } : { value: "", source: "user" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const ready = resolution?.status === "resolved" && current;
  const valid = pts.filter((p) => parseFloat(p.energy) > 0 && (parseFloat(p.mu) > 0 || parseFloat(p.mu_rho) > 0));

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const d = parseFloat(density.value);
      const dens = Number.isFinite(d) && d > 0 ? { value: d, source: density.source } : null;
      const r = await api.experimental({
        material,
        energy_unit: unit,
        density: dens,
        points: valid.map((p) => ({
          energy: parseFloat(p.energy),
          mu: parseFloat(p.mu) > 0 ? parseFloat(p.mu) : null,
          mu_rho: parseFloat(p.mu_rho) > 0 ? parseFloat(p.mu_rho) : null,
          uncertainty: parseFloat(p.unc) >= 0 ? parseFloat(p.unc) : null,
        })),
      });
      setResult(r);
      const es = r.points.map((p) => p.energy_MeV);
      const lo = Math.max(1e-3, Math.min(...es) / 3);
      const hi = Math.min(1e5, Math.max(...es) * 3);
      const s = await api.spectrum(material, { value: lo, unit: "MeV" }, { value: hi, unit: "MeV" }, 300);
      setCurve(s);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Comparison failed.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!result) return;
    const head = "energy_" + unit + ",exp_mu_rho_cm2_g,xcom_mu_rho_cm2_g,exp_mu_cm-1,xcom_mu_cm-1,percent_difference,relative_error";
    const body = result.points
      .map((p) => [p.energy, p.exp_mu_rho, p.xcom_mu_rho, p.exp_mu, p.xcom_mu, p.percent_difference, p.relative_error].map((v) => (v ?? "")).join(","))
      .join("\n");
    const meta = `# material: ${result.material.name ?? material.input}\n# dataset: NIST XCOM (total with coherent scattering)\n# density_g_cm3: ${result.density?.value ?? ""}\n`;
    download("xcom_vs_experiment.csv", meta + head + "\n" + body + "\n");
  };

  const plot = useMemo(() => {
    if (!result) return null;
    const traces: Data[] = [];
    if (curve)
      traces.push({
        x: curve.energy_MeV.map((e) => e * 1000),
        y: curve.mass_attenuation.total_with_coherent,
        type: "scatter",
        mode: "lines",
        name: "XCOM (theory)",
        line: { color: soft, width: 1.8 },
      });
    const exp = result.points.filter((p) => p.exp_mu_rho);
    traces.push({
      x: exp.map((p) => p.energy_MeV * 1000),
      y: exp.map((p) => p.exp_mu_rho),
      type: "scatter",
      mode: "markers",
      name: "Experimental",
      marker: { color: ink, size: 8, symbol: "circle", line: { color: dark ? "#18181b" : "#ffffff", width: 1.5 } },
      error_y: {
        type: "data",
        array: exp.map((p) => (p.uncertainty != null ? (p.exp_mu_rho_derived_from_mu && result.density ? p.uncertainty / result.density.value : p.uncertainty) : 0)),
        visible: exp.some((p) => p.uncertainty != null),
        color: ink,
      },
    });
    return traces;
  }, [result, curve, ink, soft, dark]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Experimental data comparison</h1>
        <p className="text-sm text-muted-foreground">Compare measured μ or μ/ρ with XCOM theory (total attenuation with coherent scattering). CSV import and export supported.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Material</Label>
                <Tabs value={mixing ? "mix" : "single"} onValueChange={(v) => setMixing(v === "mix")}>
                  <TabsList className="h-8">
                    <TabsTrigger value="single" className="text-xs">
                      Single
                    </TabsTrigger>
                    <TabsTrigger value="mix" className="text-xs">
                      Mixture
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {mixing ? (
                <MixtureBuilder
                  initial={material.input}
                  onChange={(expr) => setMaterial((m) => (expr === m.input ? m : { input: expr, choices: m.choices, composition: null }))}
                />
              ) : (
                <MaterialInput size="sm" value={material.input} loading={loading} onChange={(v) => setMaterial({ input: v, choices: material.choices, composition: null })} />
              )}
              <RecognitionStatus resolution={resolution} loading={loading} error={error} />
              <DensityInput state={density} onChange={setDensity} suggestion={suggested} estimate={ready ? resolution?.density_estimate : null} />
            </CardContent>
          </Card>
          {resolution && resolution.status !== "resolved" && (
            <CompositionCard
              resolution={resolution}
              manual={!!material.composition}
              onChoice={(k, id) => setMaterial({ ...material, choices: { ...material.choices, [k]: id } })}
              onManualComposition={(c) => setMaterial({ ...material, composition: c })}
              onReplaceInput={(t) => setMaterial({ input: t, choices: material.choices, composition: null })}
            />
          )}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Measurements</CardTitle>
                <CardDescription>Give μ (cm⁻¹, needs density) or μ/ρ (cm²/g) per energy.</CardDescription>
              </div>
              <Select value={unit} onValueChange={(u) => setUnit(u as EnergyUnit)}>
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
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_1fr_0.8fr_auto] gap-2 text-xs text-muted-foreground">
                <span>Energy ({unit})</span>
                <span>μ (cm⁻¹)</span>
                <span>μ/ρ (cm²/g)</span>
                <span>± unc.</span>
                <span className="w-9" />
              </div>
              {pts.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_0.8fr_auto] gap-2">
                  {(["energy", "mu", "mu_rho", "unc"] as const).map((k) => (
                    <Input
                      key={k}
                      className="mono-num"
                      inputMode="decimal"
                      aria-label={`${k} row ${i + 1}`}
                      value={p[k]}
                      onChange={(e) => setPts(pts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
                    />
                  ))}
                  <Button variant="ghost" size="icon" aria-label="Remove row" onClick={() => setPts(pts.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setPts([...pts, { ...EMPTY }])}>
                  <Plus /> Row
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload /> Import CSV
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,text/csv"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const { rows, error } = parseCsv(await f.text());
                    if (error) setErr(error);
                    else {
                      setErr(null);
                      setPts(rows);
                    }
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => download("template.csv", "energy,mu,mu_rho,uncertainty\n661.657,,0.1101,0.002\n")}>
                  <Download /> CSV template
                </Button>
              </div>
              <Button className="mt-2 w-full" disabled={!ready || valid.length === 0 || busy} onClick={run}>
                {busy ? <Loader2 className="animate-spin" /> : <FlaskConical />} Compare with XCOM
              </Button>
              {err && <p className="text-sm text-destructive">{err}</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>XCOM theory vs experiment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                {plot ? (
                  <Plot
                    className="h-full"
                    data={plot}
                    layout={{
                      xaxis: { type: "log", title: { text: "Photon energy (keV)" }, exponentformat: "power" },
                      yaxis: { type: "log", title: { text: "μ/ρ (cm²/g)" }, exponentformat: "power" },
                      hovermode: "closest",
                    }}
                  />
                ) : (
                  <div className="grid h-full place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Enter measurements and compare</div>
                )}
              </div>
            </CardContent>
          </Card>
          {result && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Deviation from XCOM</CardTitle>
                  {result.summary && (
                    <CardDescription className="mono-num">
                      n = {result.summary.n} · mean {fmt(result.summary.mean_percent_difference, 3)} % · mean |Δ| {fmt(result.summary.mean_absolute_percent_difference, 3)} % · RMS{" "}
                      {fmt(result.summary.rms_percent_difference, 3)} %
                    </CardDescription>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download /> Export CSV
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Energy ({unit})</TableHead>
                      <TableHead>μ/ρ exp.</TableHead>
                      <TableHead>μ/ρ XCOM</TableHead>
                      <TableHead>μ exp.</TableHead>
                      <TableHead>μ XCOM</TableHead>
                      <TableHead>Δ (%)</TableHead>
                      <TableHead>Rel. error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="mono-num">
                    {result.points.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.energy}</TableCell>
                        <TableCell>
                          {fmt(p.exp_mu_rho)}
                          {p.exp_mu_rho_derived_from_mu && <span className="text-muted-foreground"> *</span>}
                        </TableCell>
                        <TableCell>{fmt(p.xcom_mu_rho)}</TableCell>
                        <TableCell>{fmt(p.exp_mu)}</TableCell>
                        <TableCell>{fmt(p.xcom_mu)}</TableCell>
                        <TableCell className={cn(p.percent_difference != null && Math.abs(p.percent_difference) > 5 && "font-semibold")}>
                          {p.percent_difference != null ? fmt(p.percent_difference, 3) : "—"}
                        </TableCell>
                        <TableCell>{fmt(p.relative_error, 3)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-xs text-muted-foreground">
                  Δ = (exp − XCOM)/XCOM × 100 %. Relative error = |exp − XCOM|/XCOM. * μ/ρ derived from measured μ and the density
                  {result.density ? ` (${result.density.value} g/cm³)` : ""}. Measured narrow-beam data should be compared with the total including coherent scattering;
                  broad-beam geometries include build-up and will give lower apparent μ.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

