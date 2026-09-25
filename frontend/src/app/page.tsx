"use client";
import { useEffect, useRef, useState } from "react";
import { Calculator, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaterialInput } from "@/components/material-input";
import { MixtureBuilder } from "@/components/mixture-builder";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompositionCard, RecognitionStatus } from "@/components/composition-card";
import { EnergyInput, selectedEnergies, useIsotopes, type EnergySelection } from "@/components/energy-input";
import { DensityInput, type DensityState } from "@/components/density-input";
import { ResultsPanel } from "@/components/results-panel";
import { RangeInput, SpectrumChart, type RangeState } from "@/components/spectrum-chart";
import { useResolution } from "@/hooks/use-resolution";
import { api, ApiError } from "@/lib/api";
import { energyToMeV } from "@/lib/units";
import type { CalculateResponse, LengthUnit, MaterialInputState } from "@/lib/types";

const EXAMPLES = ["Bi2WO6", "PbWO4", "PMMA", "polyethylene", "water", "epoxy", "concrete"];

export default function CalculatorPage() {
  const [material, setMaterial] = useState<MaterialInputState>({ input: "", choices: {}, composition: null });
  const [mode, setMode] = useState<"single" | "mixture">("single");
  const [builderKey, setBuilderKey] = useState(0);
  const { resolution, loading, error, current } = useResolution(material);
  const inputRef = useRef<HTMLInputElement>(null);
  const { isotopes, dataset } = useIsotopes();
  const [energy, setEnergy] = useState<EnergySelection>({ mode: "energy", value: "661.657", unit: "keV", isotope: null, lines: [] });
  const [density, setDensity] = useState<DensityState>({ value: "", source: "user" });
  const [thickness, setThickness] = useState({ value: "1.0", unit: "cm" as LengthUnit });
  const [range, setRange] = useState<RangeState>({ min: "10", minUnit: "keV", max: "10", maxUnit: "MeV" });
  const [result, setResult] = useState<CalculateResponse | null>(null);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Density follows the material: when a *different* material is recognised the
  // previous value (database or user) is dropped and the database value, if
  // any, is suggested. A user value is kept while the same material is edited.
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

  const setInput = (text: string) => setMaterial((m) => ({ input: text, choices: m.choices, composition: null }));
  const ready = resolution?.status === "resolved" && current;
  const energies = selectedEnergies(energy, isotopes);
  const d = parseFloat(density.value);
  const densityValid = density.value === "" || (Number.isFinite(d) && d > 0);
  const t = parseFloat(thickness.value);
  const canCalc = ready && energies.length > 0 && densityValid;

  const calculate = async () => {
    if (!canCalc) return;
    setCalculating(true);
    setCalcError(null);
    try {
      const r = await api.calculate({
        material,
        energies,
        density: density.value !== "" ? { value: d, source: density.source } : null,
        thickness: Number.isFinite(t) && t >= 0 ? { value: t, unit: thickness.unit } : null,
      });
      setResult(r);
    } catch (e) {
      setCalcError(e instanceof ApiError ? e.message : "Calculation failed.");
      setResult(null);
    } finally {
      setCalculating(false);
    }
  };

  // Stale result guard: clear when inputs change.
  const sig = JSON.stringify([material, energies, density, thickness]);
  const lastSig = useRef(sig);
  useEffect(() => {
    if (lastSig.current !== sig) {
      lastSig.current = sig;
      setResult(null);
    }
  }, [sig]);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Gamma-ray attenuation calculator</h1>
          <p className="text-sm text-muted-foreground">
            Enter a single material, or build a mixture of any materials in any ratio. The composition is calculated and shown below for you to verify.
          </p>
        </div>
        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as "single" | "mixture");
            setBuilderKey((k) => k + 1);
          }}
        >
          <TabsList>
            <TabsTrigger value="single">Single material</TabsTrigger>
            <TabsTrigger value="mixture">Mixture / composite</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "single" ? (
          <MaterialInput inputRef={inputRef} value={material.input} onChange={setInput} loading={loading} autoFocus />
        ) : (
          <MixtureBuilder key={builderKey} initial={material.input} onChange={setInput} />
        )}
        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
          {material.input.trim() ? (
            <RecognitionStatus resolution={resolution} loading={loading} error={error} />
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{mode === "single" ? "Examples:" : ""}</span>
              {mode === "single" && EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setInput(x)} className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
                  {x}
                </button>
              ))}
            </>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          {resolution && material.input.trim() && (
            <CompositionCard
              resolution={resolution}
              manual={!!material.composition}
              onChoice={(k, id) => setMaterial({ ...material, choices: { ...material.choices, [k]: id } })}
              onManualComposition={(c) => setMaterial({ ...material, composition: c })}
              onReplaceInput={(text) => {
                setMode("single");
                setInput(text);
                inputRef.current?.focus();
              }}
            />
          )}
          <Card>
            <CardContent className="space-y-5">
              <EnergyInput sel={energy} onChange={setEnergy} isotopes={isotopes} dataset={dataset} />
              <DensityInput state={density} onChange={setDensity} suggestion={suggested} estimate={ready ? resolution?.density_estimate : null} />
              <div className="space-y-1.5">
                <Label>Thickness</Label>
                <div className="flex gap-2">
                  <Input
                    inputMode="decimal"
                    className="h-10 flex-1 text-base mono-num"
                    value={thickness.value}
                    aria-label="Thickness"
                    onChange={(e) => setThickness({ ...thickness, value: e.target.value })}
                  />
                  <Select value={thickness.unit} onValueChange={(u) => setThickness({ ...thickness, unit: u as LengthUnit })}>
                    <SelectTrigger className="!h-10 w-24" aria-label="Thickness unit">
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
              <Button size="lg" className="w-full" disabled={!canCalc || calculating} onClick={calculate}>
                {calculating ? <Loader2 className="animate-spin" /> : <Calculator />} Calculate
              </Button>
              {!ready && material.input.trim() && resolution && (
                <p className="text-center text-xs text-muted-foreground">Resolve the material above to enable the calculation.</p>
              )}
              {energies.length === 0 && <p className="text-center text-xs text-muted-foreground">Enter a photon energy or choose gamma lines.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {calcError && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{calcError}</p>}
          {result ? (
            <ResultsPanel data={result} lengthUnit={thickness.unit} />
          ) : (
            <Card className="border-dashed">
              <CardContent className="grid min-h-40 place-items-center text-center text-sm text-muted-foreground">
                {ready ? "Press Calculate to compute attenuation and shielding quantities." : "Results will appear here."}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Mass attenuation vs photon energy</CardTitle>
              <RangeInput range={range} onChange={setRange} />
            </CardHeader>
            <CardContent>
              <SpectrumChart
                material={material}
                range={range}
                ready={!!ready}
                markers={energies.map((e) => energyToMeV(e.value, e.unit))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
