"""Elemental composition in mass fractions.

All compositions are stored as **mass fractions** keyed by element symbol.
Atom counts (from a formula) are converted with IUPAC 2021 standard atomic
weights:

    w_i = n_i * A_i / sum_j(n_j * A_j)

Mixtures of components with component mass fractions W_k combine as

    w_i(mixture) = sum_k W_k * w_i(k)

Atom fractions and mass fractions are never mixed: a mixture is only ever
built from mass fractions.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .elements import element, elements_by_symbol

SUM_TOLERANCE = 1e-9


class CompositionError(ValueError):
    pass


@dataclass
class Composition:
    mass_fractions: dict[str, float]
    formula: str | None = None
    counts: dict[str, float] | None = None
    molar_mass: float | None = None  # g/mol per formula unit / repeat unit
    notes: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        known = elements_by_symbol()
        for sym, w in self.mass_fractions.items():
            if sym not in known:
                raise CompositionError(f"Unknown element '{sym}'.")
            if w < 0:
                raise CompositionError(f"Negative mass fraction for {sym}.")
        total = sum(self.mass_fractions.values())
        if total <= 0:
            raise CompositionError("Composition is empty.")
        if abs(total - 1.0) > SUM_TOLERANCE:
            raise CompositionError(f"Mass fractions sum to {total:.12g}, not 1. Normalise explicitly first.")

    # ------------------------------------------------------------------
    @classmethod
    def from_counts(cls, counts: dict[str, float], formula: str | None = None) -> "Composition":
        masses = {s: n * element(s).atomic_weight for s, n in counts.items()}
        molar = sum(masses.values())
        fractions = {s: m / molar for s, m in masses.items()}
        return cls(mass_fractions=_renormalize(fractions), formula=formula, counts=dict(counts), molar_mass=molar)

    @classmethod
    def from_mass_fractions(
        cls, fractions: dict[str | int, float], normalize: bool = False, tolerance: float = 1e-3
    ) -> "Composition":
        """Build from explicit mass fractions (keys: symbol or Z).

        Unless ``normalize`` is True the fractions must already sum to 1
        within ``tolerance``; they are then renormalised exactly.
        """
        by_sym: dict[str, float] = {}
        for k, v in fractions.items():
            sym = element(int(k)).symbol if (isinstance(k, int) or str(k).isdigit()) else str(k)
            if sym not in elements_by_symbol():
                raise CompositionError(f"Unknown element '{k}'.")
            if v < 0:
                raise CompositionError(f"Negative mass fraction for {sym}.")
            if v > 0:
                by_sym[sym] = by_sym.get(sym, 0.0) + float(v)
        total = sum(by_sym.values())
        if total <= 0:
            raise CompositionError("Composition is empty.")
        if not normalize and abs(total - 1.0) > tolerance:
            raise CompositionError(f"Mass fractions sum to {total * 100:.4g}%, expected 100%.")
        return cls(mass_fractions=_renormalize(by_sym))

    @classmethod
    def mix(cls, parts: list[tuple["Composition", float]]) -> "Composition":
        """Mix components by *mass* fraction. Fractions must sum to 1."""
        total = sum(w for _, w in parts)
        if abs(total - 1.0) > 1e-9:
            raise CompositionError(f"Component mass fractions sum to {total * 100:.6g}%, expected 100%.")
        out: dict[str, float] = {}
        for comp, w in parts:
            if w < 0:
                raise CompositionError("Negative component fraction.")
            for s, f in comp.mass_fractions.items():
                out[s] = out.get(s, 0.0) + w * f
        return cls(mass_fractions=_renormalize(out))

    # ------------------------------------------------------------------
    def atom_fractions(self) -> dict[str, float]:
        """Atom (number) fractions derived from mass fractions."""
        moles = {s: w / element(s).atomic_weight for s, w in self.mass_fractions.items()}
        t = sum(moles.values())
        return {s: m / t for s, m in moles.items()}

    def sorted_items(self) -> list[tuple[str, float]]:
        return sorted(self.mass_fractions.items(), key=lambda kv: element(kv[0]).Z)

    def to_dict(self) -> dict:
        return {
            "formula": self.formula,
            "molar_mass": self.molar_mass,
            "elements": [
                {
                    "symbol": s,
                    "Z": element(s).Z,
                    "name": element(s).name,
                    "mass_fraction": w,
                    "atom_count": (self.counts or {}).get(s),
                    "atomic_weight": element(s).atomic_weight,
                }
                for s, w in self.sorted_items()
            ],
            "notes": self.notes,
        }


def _renormalize(fr: dict[str, float]) -> dict[str, float]:
    t = sum(fr.values())
    return {s: v / t for s, v in fr.items() if v > 0}
