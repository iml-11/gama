/** Format a number with `sig` significant digits; scientific notation for very large/small values. */
export function fmt(x: number | null | undefined, sig = 4): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e5 || a < 1e-3) {
    const [m, e] = x.toExponential(sig - 1).split("e");
    return `${m} × 10${superscript(e)}`;
  }
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return x.toFixed(Math.min(digits, 10));
}

export function fmtPlain(x: number | null | undefined, sig = 6): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "";
  return Number(x.toPrecision(sig)).toString();
}

const SUP: Record<string, string> = { "-": "⁻", "+": "", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
export function superscript(s: string): string {
  return s.replace(/^\+/, "").split("").map((c) => SUP[c] ?? c).join("");
}

export function pct(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x.toFixed(digits)} %`;
}

/** Pretty energy: choose keV or MeV. */
export function fmtEnergy(mev: number): string {
  if (mev < 1) return `${fmtPlain(mev * 1000, 6)} keV`;
  if (mev >= 1000) return `${fmtPlain(mev / 1000, 6)} GeV`;
  return `${fmtPlain(mev, 6)} MeV`;
}

export function fmtLength(cm: number | null | undefined, unit: "mm" | "cm" | "m" = "cm", sig = 4): string {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return "—";
  const f = unit === "mm" ? 10 : unit === "m" ? 0.01 : 1;
  return `${fmt(cm * f, sig)} ${unit}`;
}

export function fmtHalfLife(s: number): string {
  const y = s / (365.25 * 86400);
  if (y >= 1) return `${fmtPlain(y, 4)} y`;
  const d = s / 86400;
  if (d >= 1) return `${fmtPlain(d, 4)} d`;
  const h = s / 3600;
  if (h >= 1) return `${fmtPlain(h, 4)} h`;
  return `${fmtPlain(s, 4)} s`;
}
