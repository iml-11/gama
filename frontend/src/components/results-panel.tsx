"use client";
import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DetailsSheet } from "@/components/details-sheet";
import { Formula } from "@/components/formula";
import { fmt, fmtEnergy } from "@/lib/format";
import type { CalculateResponse, LengthUnit, ResultRow } from "@/lib/types";
import { cn } from "@/lib/utils";

function Metric({ label, value, unit, hint, disabled, emphasis }: { label: string; value: string; unit?: string; hint?: string; disabled?: boolean; emphasis?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card p-3", disabled && "opacity-50", emphasis && "border-primary/30 bg-primary/[0.04]")}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="size-3" />
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className={cn("mt-1 font-semibold tracking-tight num", emphasis ? "text-2xl" : "text-xl")}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

const LEN_FACTOR: Record<LengthUnit, number> = { um: 1e4, mm: 10, cm: 1, m: 0.01 };

export function ResultsPanel({ data, lengthUnit }: { data: CalculateResponse; lengthUnit: LengthUnit }) {
  const [idx, setIdx] = useState(0);
  const [withCoherent, setWithCoherent] = useState(true);
  const row: ResultRow = data.results[Math.min(idx, data.results.length - 1)];
  const ma = row.mass_attenuation;
  const total = withCoherent ? ma.total_with_coherent : ma.total_without_coherent;
  const sh = withCoherent ? row.shielding : row.shielding_without_coherent;
  const lf = LEN_FACTOR[lengthUnit];
  const L = (cm: number | null | undefined) => (cm === null || cm === undefined ? "—" : fmt(cm * lf, 4));
  const noDensity = !data.density_dependent_enabled;
  const m = data.material;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {m.kind === "formula" && m.formula ? <Formula text={m.formula} repeat={m.repeat_unit} className="font-normal" /> : m.name} ·{" "}
              {fmtEnergy(row.energy_MeV)}
              {row.energy_input?.label ? ` · ${row.energy_input.label}` : ""} · NIST XCOM
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="coh" checked={withCoherent} onCheckedChange={setWithCoherent} />
              <Label htmlFor="coh">Include coherent scattering</Label>
            </div>
            <DetailsSheet data={data} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.results.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {data.results.map((r, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setIdx(i)}
                  className={cn("rounded-md border px-2 py-1 text-xs num", i === idx ? "border-primary/50 bg-primary/10" : "text-muted-foreground hover:bg-accent/50")}
                >
                  {fmtEnergy(r.energy_MeV)}
                </button>
              ))}
            </div>
          )}
          {!row.available ? (
            <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm">
              <AlertTriangle className="size-4 shrink-0 text-warning" /> {row.unavailable_reason}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="col-span-2">
                  <Metric
                    emphasis
                    label={`Mass attenuation coefficient μ/ρ ${withCoherent ? "(with coherent)" : "(without coherent)"}`}
                    value={fmt(total, 5)}
                    unit="cm²/g"
                    hint="Independent of density. Mixture rule over elemental XCOM values."
                  />
                </div>
                <div className="col-span-2">
                  <Metric emphasis label="Linear attenuation coefficient μ" value={sh ? fmt(sh.mu_cm_inv, 5) : "—"} unit="cm⁻¹" disabled={noDensity} hint="μ = ρ · (μ/ρ)" />
                </div>
                <Metric label="Half-value layer" value={L(sh?.hvl_cm)} unit={lengthUnit} disabled={noDensity} hint="HVL = ln 2 / μ" />
                <Metric label="Tenth-value layer" value={L(sh?.tvl_cm)} unit={lengthUnit} disabled={noDensity} hint="TVL = ln 10 / μ" />
                <Metric label="Mean free path" value={L(sh?.mfp_cm)} unit={lengthUnit} disabled={noDensity} hint="MFP = 1 / μ" />
                <Metric
                  label={data.thickness ? `Transmission (${data.thickness.value} ${data.thickness.unit})` : "Transmission"}
                  value={sh?.transmission !== null && sh?.transmission !== undefined ? fmt(sh.transmission * 100, 4) : "—"}
                  unit="%"
                  disabled={noDensity || !data.thickness}
                  hint="I/I₀ = exp(−μx), narrow beam"
                />
                <div className="col-span-2 md:col-span-4">
                  <Metric
                    label={data.thickness ? `Shielding efficiency (${data.thickness.value} ${data.thickness.unit})` : "Shielding efficiency"}
                    value={sh?.shielding_efficiency_percent !== null && sh?.shielding_efficiency_percent !== undefined ? fmt(sh.shielding_efficiency_percent, 4) : "—"}
                    unit="%"
                    disabled={noDensity || !data.thickness}
                    hint="SE = (1 − exp(−μx)) × 100 %"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {data.density ? (
                  <>
                    Density {data.density.value} g/cm³ <Badge variant={data.density.source === "user" ? "secondary" : data.density.source === "estimate" ? "warning" : "default"}>{data.density.label}</Badge>
                  </>
                ) : (
                  <span className="text-warning">No density given – density-dependent quantities are disabled.</span>
                )}
                <span>· Narrow-beam attenuation (no build-up).</span>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Partial mass attenuation coefficients (cm²/g)</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Coherent</TableHead>
                      <TableHead>Incoherent</TableHead>
                      <TableHead>Photoelectric</TableHead>
                      <TableHead>Pair (nuclear)</TableHead>
                      <TableHead>Pair (electron)</TableHead>
                      <TableHead>Total w/ coh.</TableHead>
                      <TableHead>Total w/o coh.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="num">
                    <TableRow>
                      <TableCell>{fmt(ma.coherent)}</TableCell>
                      <TableCell>{fmt(ma.incoherent)}</TableCell>
                      <TableCell>{fmt(ma.photoelectric)}</TableCell>
                      <TableCell>{fmt(ma.pair_nuclear)}</TableCell>
                      <TableCell>{fmt(ma.pair_electron)}</TableCell>
                      <TableCell className="font-medium">{fmt(ma.total_with_coherent)}</TableCell>
                      <TableCell>{fmt(ma.total_without_coherent)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {data.results.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>All selected energies</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Energy</TableHead>
                  <TableHead>μ/ρ (cm²/g)</TableHead>
                  <TableHead>μ (cm⁻¹)</TableHead>
                  <TableHead>HVL ({lengthUnit})</TableHead>
                  <TableHead>TVL ({lengthUnit})</TableHead>
                  <TableHead>Transmission (%)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="num">
                {data.results.map((r, i) => {
                  const s = withCoherent ? r.shielding : r.shielding_without_coherent;
                  return (
                    <TableRow key={i}>
                      <TableCell>{fmtEnergy(r.energy_MeV)}</TableCell>
                      <TableCell>{fmt(withCoherent ? r.mass_attenuation.total_with_coherent : r.mass_attenuation.total_without_coherent)}</TableCell>
                      <TableCell>{fmt(s?.mu_cm_inv)}</TableCell>
                      <TableCell>{L(s?.hvl_cm)}</TableCell>
                      <TableCell>{L(s?.tvl_cm)}</TableCell>
                      <TableCell>{s?.transmission != null ? fmt(s.transmission * 100) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
