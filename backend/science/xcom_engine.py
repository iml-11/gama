"""Photon attenuation engine based on the NIST XCOM elemental database.

Data: ``data/xcom/Znnn.json`` (barn/atom, energies in MeV), converted without
modification from the XCOM MDATX3 data files (see ``scripts/build_xcom_data.py``
and ``data/xcom/manifest.json``).

Elemental cross section sigma_i (barn/atom) -> mass attenuation coefficient

    (mu/rho)_i = sigma_i * N_A / A_i          [cm^2/g]

with N_A = 0.60221367e24 /mol (value used by XCOM) and A_i the atomic weight
table used by the XCOM program (so elemental results reproduce XCOM).

Mixtures / compounds (Bragg additivity, XCOM "mixture rule"):

    (mu/rho)_mix = sum_i w_i (mu/rho)_i

with w_i the elemental **mass** fractions.

Interpolation: see :mod:`science.interpolation`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .interpolation import (
    PAIR_ELECTRON_THRESHOLD_MEV,
    PAIR_NUCLEAR_THRESHOLD_MEV,
    LogLogSpline,
    PairSpline,
    PhotoelectricInterpolator,
    _dedupe,
)
from .elements import element
from .paths import XCOM_DIR

PROCESSES = ("coherent", "incoherent", "photoelectric", "pair_nuclear", "pair_electron")
E_MIN_MEV = 1e-3
E_MAX_MEV = 1e5


class XcomError(ValueError):
    pass


@lru_cache(maxsize=1)
def manifest() -> dict:
    return json.loads((XCOM_DIR / "manifest.json").read_text())


def dataset_info() -> dict:
    m = manifest()
    return {
        "name": m["dataset"],
        "authors": m["authors"],
        "url": m["url"],
        "doi": m["doi"],
        "conversion": m["conversion"],
        "source_sha256": m["source_sha256"],
        "energy_range_MeV": m["energy_range_MeV"],
    }


@dataclass
class ElementData:
    Z: int
    atomic_weight: float
    energy: np.ndarray
    raw: dict
    interpolators: dict
    edges: list[dict]
    unavailable: list[tuple[float, float, str]]


@lru_cache(maxsize=None)
def element_data(z: int) -> ElementData:
    path = XCOM_DIR / f"Z{z:03d}.json"
    if not path.exists():
        raise XcomError(f"No XCOM data for Z={z}.")
    d = json.loads(path.read_text())
    e = np.asarray(d["energy"], dtype=float)
    arr = {p: np.asarray(d[p], dtype=float) for p in PROCESSES}
    interps = {
        "coherent": LogLogSpline(*_dedupe(e, arr["coherent"])),
        "incoherent": LogLogSpline(*_dedupe(e, arr["incoherent"])),
        "pair_nuclear": PairSpline(*_dedupe(e, arr["pair_nuclear"]), PAIR_NUCLEAR_THRESHOLD_MEV),
        "pair_electron": PairSpline(*_dedupe(e, arr["pair_electron"]), PAIR_ELECTRON_THRESHOLD_MEV),
    }
    pe = PhotoelectricInterpolator(e, arr["photoelectric"], d["edges"], d.get("incomplete_edges", []))
    interps["photoelectric"] = pe
    return ElementData(
        Z=z,
        atomic_weight=d["atomic_weight_xcom"],
        energy=e,
        raw={p: arr[p] for p in PROCESSES},
        interpolators=interps,
        edges=[{"label": x["label"], "energy_MeV": x["energy"]} for x in d["edges"]],
        unavailable=pe.unavailable,
    )


def _check_energies(e: np.ndarray) -> None:
    if e.size == 0:
        raise XcomError("No energies given.")
    if np.any(~np.isfinite(e)):
        raise XcomError("Energies must be finite numbers.")
    lo, hi = e.min(), e.max()
    if lo < E_MIN_MEV * (1 - 1e-9) or hi > E_MAX_MEV * (1 + 1e-9):
        raise XcomError(
            f"Photon energy outside the XCOM range (1 keV - 100 GeV): got {lo * 1e3:g} keV - {hi * 1e3:g} keV."
        )


def cross_sections(z: int, energies_mev) -> dict[str, np.ndarray]:
    """Partial cross sections in barn/atom. Unavailable values are NaN."""
    e = np.atleast_1d(np.asarray(energies_mev, dtype=float))
    _check_energies(e)
    ed = element_data(z)
    out = {p: np.asarray(ed.interpolators[p](e), dtype=float) for p in PROCESSES}
    # Exact tabulated values at grid energies (upper side at edges).
    for i, ei in enumerate(e):
        idx = np.nonzero(np.abs(ed.energy - ei) <= 1e-12 * ei)[0]
        if idx.size:
            j = idx[-1]
            for p in PROCESSES:
                if p == "photoelectric" and np.isnan(out[p][i]):
                    continue
                out[p][i] = ed.raw[p][j]
    return out


def element_mass_attenuation(z: int, energies_mev) -> dict[str, np.ndarray]:
    """Partial and total mass attenuation coefficients in cm^2/g for one element."""
    cs = cross_sections(z, energies_mev)
    factor = manifest()["avogadro_xcom"] / element_data(z).atomic_weight
    out = {p: cs[p] * factor for p in PROCESSES}
    return _totals(out)


def _totals(out: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    out["pair_total"] = out["pair_nuclear"] + out["pair_electron"]
    out["total_without_coherent"] = out["incoherent"] + out["photoelectric"] + out["pair_total"]
    out["total_with_coherent"] = out["total_without_coherent"] + out["coherent"]
    return out


def mixture_mass_attenuation(mass_fractions: dict[str, float], energies_mev) -> dict[str, np.ndarray]:
    """Mixture rule: (mu/rho) = sum_i w_i (mu/rho)_i, in cm^2/g."""
    e = np.atleast_1d(np.asarray(energies_mev, dtype=float))
    total = sum(mass_fractions.values())
    if abs(total - 1.0) > 1e-6:
        raise XcomError(f"Mass fractions must sum to 1 (got {total:.8g}).")
    acc = {p: np.zeros_like(e) for p in PROCESSES}
    for sym, w in mass_fractions.items():
        el = element_mass_attenuation(element(sym).Z, e)
        for p in PROCESSES:
            acc[p] = acc[p] + w * el[p]
    return _totals(acc)


def unavailable_ranges(symbols) -> list[dict]:
    """Energy ranges where the photoelectric value is missing from the data."""
    out = []
    for s in symbols:
        z = element(s).Z
        for lo, hi, label in element_data(z).unavailable:
            out.append({"element": s, "edge": label, "from_MeV": lo, "to_MeV": hi})
    return out


def edges_in_range(symbols, e_min: float, e_max: float) -> list[dict]:
    out = []
    for s in symbols:
        for ed in element_data(element(s).Z).edges:
            if e_min <= ed["energy_MeV"] <= e_max:
                out.append({"element": s, "label": ed["label"], "energy_MeV": ed["energy_MeV"]})
    return sorted(out, key=lambda d: d["energy_MeV"])


def table_energies(symbols, e_min: float, e_max: float) -> list[dict]:
    """Energies for a tabulated output, as XCOM prints them.

    The XCOM standard energy grid (80 energies, 1 keV-100 GeV) within the
    range, plus both tabulated sides of every absorption edge of the
    constituent elements. Returns [{"energy_MeV", "edge"}] sorted by energy,
    where ``edge`` labels the rows that sit at an edge (e.g. "Pb K").
    """
    from .interpolation import edge_pair_mask

    rows: dict[float, str | None] = {}
    std = element_data(1).energy  # hydrogen has no edges: its grid is the standard grid
    for e in std:
        if e_min * (1 - 1e-12) <= e <= e_max * (1 + 1e-12):
            rows[float(e)] = None
    for s in symbols:
        ed = element_data(element(s).Z)
        second = edge_pair_mask(ed.energy)
        first = np.zeros_like(second)
        first[:-1] = second[1:]
        for i in np.nonzero(first | second)[0]:
            e = float(ed.energy[i])
            if not (e_min * (1 - 1e-12) <= e <= e_max * (1 + 1e-12)):
                continue
            upper = e if second[i] else float(ed.energy[i + 1])
            label = next((x["label"] for x in ed.edges if abs(x["energy_MeV"] - upper) <= 1e-9 * upper + 2e-7), None)
            rows[e] = f"{s} {label}" if label else rows.get(e)
        for lo, _hi, label in ed.unavailable:
            if e_min <= lo <= e_max:
                rows.setdefault(lo, f"{s} {label}")
    return [{"energy_MeV": e, "edge": rows[e]} for e in sorted(rows)]


def plot_grid(symbols, e_min: float, e_max: float, points: int = 400) -> np.ndarray:
    """Log-spaced grid that includes both sides of every absorption edge."""
    e_min = max(e_min, E_MIN_MEV)
    e_max = min(e_max, E_MAX_MEV)
    if e_max <= e_min:
        raise XcomError("Energy range is empty.")
    grid = set(np.geomspace(e_min, e_max, points).tolist())
    for ed in edges_in_range(symbols, e_min, e_max):
        grid.add(ed["energy_MeV"] * (1 - 1e-7))  # just below edge
        grid.add(ed["energy_MeV"])  # upper side
    return np.array(sorted(g for g in grid if e_min <= g <= e_max))
