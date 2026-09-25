"use client";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Formula } from "@/components/formula";
import { fmtEnergy } from "@/lib/format";
import type { CalculateResponse } from "@/lib/types";

export function DetailsSheet({ data }: { data: CalculateResponse }) {
  const { material: m, details: d } = data;
  const comp = m.composition!;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <FileText /> Calculation details
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Calculation details</SheetTitle>
          <SheetDescription>Everything needed to reproduce this result.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-5 pb-8 text-sm">
          <Section title="Material">
            <div>{m.kind === "formula" && m.formula ? <Formula text={m.formula} repeat={m.repeat_unit} /> : m.name}</div>
            {comp.molar_mass && <div className="text-muted-foreground">Molar mass {comp.molar_mass.toFixed(4)} g/mol</div>}
            {m.components.length > 0 && (
              <ul className="mt-1 text-muted-foreground">
                {m.components.map((c, i) => (
                  <li key={i}>
                    {(c.mass_percent ?? c.percent).toFixed(4)} wt% {c.resolution.name ?? c.text}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Composition used (mass fractions)">
            <table className="w-full num">
              <tbody>
                {comp.elements.map((e) => (
                  <tr key={e.symbol} className="border-b border-border/60">
                    <td className="py-1">
                      {e.symbol} <span className="text-muted-foreground">(Z = {e.Z})</span>
                    </td>
                    <td className="py-1 text-right">{e.mass_fraction.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Energy">
            {data.results.map((r, i) => (
              <div key={i}>
                {fmtEnergy(r.energy_MeV)} ({r.energy_MeV.toPrecision(7)} MeV){r.energy_input?.label ? ` — ${r.energy_input.label}` : ""}
              </div>
            ))}
          </Section>
          <Section title="Density assumption">
            {data.density ? (
              <div>
                {data.density.value} g/cm³ — {data.density.label}
              </div>
            ) : (
              <div className="text-muted-foreground">None given: only mass attenuation coefficients were computed.</div>
            )}
          </Section>
          <Section title="Dataset">
            <div>{d.dataset.name}</div>
            <div className="text-muted-foreground">{d.dataset.authors}</div>
            <div className="text-muted-foreground">
              DOI {d.dataset.doi} · <a className="text-primary hover:underline" href={d.dataset.url} target="_blank" rel="noreferrer">NIST</a>
            </div>
            <div className="text-xs text-muted-foreground">{d.dataset.conversion}</div>
            <div className="text-xs break-all text-muted-foreground">Source SHA-256: {d.dataset.source_sha256}</div>
          </Section>
          <Section title="Interpolation method">
            <p className="text-muted-foreground">{d.interpolation}</p>
          </Section>
          <Section title="Constants and atomic weights">
            <p className="text-muted-foreground">
              Formula → mass fractions: {d.atomic_weights_composition.source} ({d.atomic_weights_composition.reference}).
            </p>
            <p className="text-muted-foreground">
              barn/atom → cm²/g: {d.atomic_weights_xcom}; N<sub>A</sub> = {d.avogadro} × 10²⁴ mol⁻¹.
            </p>
          </Section>
          <Section title="Equations">
            <ul className="space-y-1 font-mono text-xs">
              {d.equations.map((e) => (
                <li key={e.name}>
                  <span className="font-sans text-muted-foreground">{e.name}: </span>
                  {e.text}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{d.geometry}</p>
          </Section>
          <Section title="Provenance">
            <ul className="space-y-1 text-xs">
              {m.provenance.map((p, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{p.item}: </span>
                  {p.source}
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}
