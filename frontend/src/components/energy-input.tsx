"use client";
import { useEffect, useState } from "react";
import { Radiation } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmtHalfLife, fmtPlain } from "@/lib/format";
import type { EnergyUnit, Isotope } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface EnergySelection {
  mode: "energy" | "isotope";
  value: string;
  unit: EnergyUnit;
  isotope: string | null;
  lines: number[]; // selected line energies (keV)
}

export const ENERGY_UNITS: EnergyUnit[] = ["eV", "keV", "MeV", "GeV"];

export function selectedEnergies(sel: EnergySelection, isotopes: Isotope[]): { value: number; unit: EnergyUnit; label?: string }[] {
  if (sel.mode === "energy") {
    const v = parseFloat(sel.value);
    return Number.isFinite(v) && v > 0 ? [{ value: v, unit: sel.unit }] : [];
  }
  const iso = isotopes.find((i) => i.id === sel.isotope);
  if (!iso) return [];
  return iso.lines
    .filter((l) => sel.lines.includes(l.energy_keV))
    .map((l) => ({
      value: l.energy_keV,
      unit: "keV" as const,
      label: l.emitter.toLowerCase() === iso.id.replace("-", "").toLowerCase() ? iso.id : `${iso.id} (${l.emitter} line)`,
    }));
}

export function useIsotopes() {
  const [isotopes, setIsotopes] = useState<Isotope[]>([]);
  const [dataset, setDataset] = useState<{ source: string; reference: string; notes: string[] } | null>(null);
  useEffect(() => {
    api
      .isotopes()
      .then((r) => {
        setIsotopes(r.isotopes);
        setDataset(r.dataset);
      })
      .catch(() => {});
  }, []);
  return { isotopes, dataset };
}

export function EnergyInput({
  sel,
  onChange,
  isotopes,
  dataset,
}: {
  sel: EnergySelection;
  onChange: (s: EnergySelection) => void;
  isotopes: Isotope[];
  dataset: { source: string } | null;
}) {
  const iso = isotopes.find((i) => i.id === sel.isotope);
  const v = parseFloat(sel.value);
  const invalid = sel.mode === "energy" && sel.value !== "" && !(Number.isFinite(v) && v > 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Photon energy</Label>
        <Tabs value={sel.mode} onValueChange={(m) => onChange({ ...sel, mode: m as EnergySelection["mode"] })}>
          <TabsList className="h-7">
            <TabsTrigger value="energy" className="px-2 text-xs">
              Energy
            </TabsTrigger>
            <TabsTrigger value="isotope" className="px-2 text-xs">
              <Radiation className="size-3.5" /> Gamma source
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {sel.mode === "energy" ? (
        <div className="flex gap-2">
          <Input
            inputMode="decimal"
            value={sel.value}
            aria-invalid={invalid}
            aria-label="Photon energy"
            placeholder="661.657"
            className="h-10 flex-1 text-base mono-num"
            onChange={(e) => onChange({ ...sel, value: e.target.value })}
          />
          <Select value={sel.unit} onValueChange={(u) => onChange({ ...sel, unit: u as EnergyUnit })}>
            <SelectTrigger className="!h-10 w-24" aria-label="Energy unit">
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
      ) : (
        <div className="space-y-2">
          <Select
            value={sel.isotope ?? ""}
            onValueChange={(id) => {
              const i = isotopes.find((x) => x.id === id);
              onChange({ ...sel, isotope: id, lines: i ? i.lines.map((l) => l.energy_keV) : [] });
            }}
          >
            <SelectTrigger className="!h-10" aria-label="Gamma source">
              <SelectValue placeholder="Select a radionuclide" />
            </SelectTrigger>
            <SelectContent>
              {isotopes.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.id} <span className="text-xs text-muted-foreground">· T½ {fmtHalfLife(i.half_life_s)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {iso && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {iso.lines.map((l) => {
                  const on = sel.lines.includes(l.energy_keV);
                  return (
                    <button
                      type="button"
                      key={`${l.emitter}-${l.energy_keV}`}
                      onClick={() =>
                        onChange({ ...sel, lines: on ? sel.lines.filter((x) => x !== l.energy_keV) : [...sel.lines, l.energy_keV] })
                      }
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs num transition-colors",
                        on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-accent/50"
                      )}
                    >
                      <span className="font-medium">{fmtPlain(l.energy_keV, 7)} keV</span>
                      <span className="ml-1 opacity-70">{fmtPlain(l.intensity_percent, 4)}%</span>
                      {l.emitter.replace(/\d+m?$/, "") !== iso.id.split("-")[0] && (
                        <span className="ml-1 opacity-70">({l.emitter})</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Lines ≥ 1 % emission probability per decay of the emitting nuclide. Source: {dataset?.source ?? "isotope dataset"}.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
