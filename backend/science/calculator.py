"""High-level calculation service combining composition, XCOM and shielding.

Pure functions returning plain dicts, used by the API layer.
"""

from __future__ import annotations

import math

import numpy as np

from . import xcom_engine as xe
from .composition import Composition
from .elements import atomic_weight_source
from .shielding import shielding

EQUATIONS = [
    {"name": "Mixture rule", "latex": r"(\mu/\rho)_{mix} = \sum_i w_i\,(\mu/\rho)_i", "text": "(mu/rho)_mix = sum_i w_i (mu/rho)_i"},
    {"name": "Element", "latex": r"(\mu/\rho)_i = \sigma_i N_A / A_i", "text": "(mu/rho)_i = sigma_i * N_A / A_i"},
    {"name": "Linear attenuation", "latex": r"\mu = \rho\,(\mu/\rho)", "text": "mu = rho * (mu/rho)"},
    {"name": "Mean free path", "latex": r"\mathrm{MFP} = 1/\mu", "text": "MFP = 1/mu"},
    {"name": "Half-value layer", "latex": r"\mathrm{HVL} = \ln 2/\mu", "text": "HVL = ln(2)/mu"},
    {"name": "Tenth-value layer", "latex": r"\mathrm{TVL} = \ln 10/\mu", "text": "TVL = ln(10)/mu"},
    {"name": "Transmission", "latex": r"I/I_0 = e^{-\mu x}", "text": "I/I0 = exp(-mu x)"},
    {"name": "Shielding efficiency", "latex": r"SE = (1 - e^{-\mu x})\times 100\%", "text": "SE = (1 - exp(-mu x)) * 100 %"},
]

INTERPOLATION_METHOD = (
    "Log-log cubic splines for coherent, incoherent and (threshold-factored) pair-production cross sections; "
    "photoelectric: log-log cubic spline above the K edge and piecewise log-log linear interpolation "
    "within each inter-edge interval below it, never across an absorption edge. "
    "Exact tabulated values at XCOM grid energies."
)


def _clean(x) -> float | None:
    x = float(x)
    return None if math.isnan(x) else x


def attenuation_at(comp: Composition, energies_mev: list[float], density: float | None, thickness_cm: float | None) -> list[dict]:
    e = np.asarray(energies_mev, dtype=float)
    mu = xe.mixture_mass_attenuation(comp.mass_fractions, e)
    unavailable = xe.unavailable_ranges(comp.mass_fractions.keys())
    out = []
    for i, ei in enumerate(e):
        row = {"energy_MeV": float(ei)}
        row["mass_attenuation"] = {k: _clean(v[i]) for k, v in mu.items()}
        total = row["mass_attenuation"]["total_with_coherent"]
        row["available"] = total is not None
        row["unavailable_reason"] = None
        if total is None:
            hits = [u for u in unavailable if u["from_MeV"] <= ei < u["to_MeV"]]
            row["unavailable_reason"] = (
                "Photoelectric cross section not available between the "
                + ", ".join(f"{u['element']} {u['edge']} edge ({u['from_MeV'] * 1e3:g} keV) and {u['to_MeV'] * 1e3:g} keV" for u in hits)
                + " in the source data conversion; no value is interpolated there."
            )
        if density and total is not None:
            row["shielding"] = shielding(total, density, thickness_cm).to_dict()
            row["shielding_without_coherent"] = shielding(
                row["mass_attenuation"]["total_without_coherent"], density, thickness_cm
            ).to_dict()
        else:
            row["shielding"] = None
            row["shielding_without_coherent"] = None
        out.append(row)
    return out


def spectrum(comp: Composition, e_min: float, e_max: float, points: int = 300) -> dict:
    syms = list(comp.mass_fractions)
    grid = xe.plot_grid(syms, e_min, e_max, points)
    mu = xe.mixture_mass_attenuation(comp.mass_fractions, grid)
    return {
        "energy_MeV": grid.tolist(),
        "mass_attenuation": {k: [_clean(x) for x in v] for k, v in mu.items()},
        "edges": xe.edges_in_range(syms, grid[0], grid[-1]),
        "unavailable": xe.unavailable_ranges(syms),
    }


def calculation_details(comp: Composition) -> dict:
    return {
        "dataset": xe.dataset_info(),
        "interpolation": INTERPOLATION_METHOD,
        "atomic_weights_composition": atomic_weight_source(),
        "atomic_weights_xcom": "XCOM program atomic-weight table (used to convert barn/atom to cm2/g, as in XCOM)",
        "avogadro": xe.manifest()["avogadro_xcom"],
        "equations": EQUATIONS,
        "geometry": "Narrow-beam (good geometry) attenuation; build-up from scattered photons is not included.",
    }
