import type { EnergyUnit } from "./types";

// Used only for display (plot markers). All calculations are done by the backend.
const TO_MEV: Record<EnergyUnit, number> = { eV: 1e-6, keV: 1e-3, MeV: 1, GeV: 1e3 };

export function energyToMeV(value: number, unit: EnergyUnit): number {
  return value * TO_MEV[unit];
}
