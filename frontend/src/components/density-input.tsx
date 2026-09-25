"use client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DensityInfo } from "@/lib/types";

export interface DensityState {
  value: string;
  source: "database" | "user" | "estimate";
}

export function DensityInput({
  state,
  onChange,
  suggestion,
  estimate,
  compact,
}: {
  state: DensityState;
  onChange: (s: DensityState) => void;
  suggestion: DensityInfo | null;
  estimate?: DensityInfo | null;
  compact?: boolean;
}) {
  const v = parseFloat(state.value);
  const invalid = state.value !== "" && !(Number.isFinite(v) && v > 0);
  const label = state.value === "" ? null : state.source === "database" ? "Database value" : state.source === "estimate" ? "Estimated value" : "User supplied value";
  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="flex items-center justify-between">
          <Label>Density</Label>
          {label && <Badge variant={state.source === "user" ? "secondary" : state.source === "estimate" ? "warning" : "default"}>{label}</Badge>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          value={state.value}
          aria-invalid={invalid}
          aria-label="Density in g/cm3"
          placeholder="optional"
          className={compact ? "w-24 text-right num" : "h-10 flex-1 text-base num"}
          onChange={(e) => onChange({ value: e.target.value, source: "user" })}
        />
        <span className="text-sm text-muted-foreground">g/cm³</span>
        {state.value !== "" && !compact && (
          <Button variant="ghost" size="sm" onClick={() => onChange({ value: "", source: "user" })}>
            Clear
          </Button>
        )}
      </div>
      {!compact && (
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {suggestion?.value ? (
            state.source === "database" && state.value === String(suggestion.value) ? (
              <p>Source: {suggestion.source}</p>
            ) : (
              <p>
                Database value available:{" "}
                <button type="button" className="text-primary hover:underline" onClick={() => onChange({ value: String(suggestion.value), source: "database" })}>
                  use {suggestion.value} g/cm³
                </button>{" "}
                ({suggestion.source})
              </p>
            )
          ) : (
            <p>No sourced density in the database for this material. Leave blank for mass attenuation only.</p>
          )}
          {estimate?.value && state.source !== "estimate" && (
            <p>
              <button type="button" className="text-primary hover:underline" onClick={() => onChange({ value: estimate.value!.toFixed(4), source: "estimate" })}>
                Use estimate {estimate.value.toFixed(3)} g/cm³
              </button>{" "}
              — {estimate.source}
            </p>
          )}
          {state.source === "estimate" && estimate && <p>{estimate.source}. Replace with a measured density if available.</p>}
          {state.value === "" && <p className="text-warning">Density-dependent outputs (μ, HVL, TVL, MFP, transmission) are disabled.</p>}
        </div>
      )}
    </div>
  );
}
