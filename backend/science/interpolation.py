"""Interpolation of NIST XCOM elemental cross sections.

Strategy (follows the approach described for XCOM by Berger & Hubbell,
NBSIR 87-3597 (1987), and in the XCOM documentation)
-------------------------------------------------------------------------
Cross sections vary over many orders of magnitude and roughly as power laws
of energy, so all interpolation is done in log-log space (ln sigma vs ln E),
never linearly in (E, sigma).

* Coherent and incoherent scattering: cubic spline in (ln E, ln sigma) over
  the full XCOM grid. These processes are continuous at absorption edges; the
  duplicated edge energies in the grid carry identical values and are
  collapsed to one node before fitting.

* Pair production (nuclear field, threshold E_th = 2 m_e c^2; electron field,
  E_th = 4 m_e c^2): the threshold factor (1 - E_th/E)^3 is divided out and
  ln[sigma / (1 - E_th/E)^3] is fitted with a cubic spline in ln E, so that the
  spline sees a smooth function near threshold. sigma = 0 for E <= E_th.

* Photoelectric absorption (discontinuous at absorption edges):
  - Above the K edge: cubic spline in (ln E, ln sigma) over the grid points
    from the K edge (upper-side value) upwards.
  - Below the K edge: every interval between two adjacent edges (or between
    1 keV and the first edge) is treated separately, using the interval nodes
    supplied in the XCOM data files for exactly this purpose (they include
    extra points inside short intervals). Inside an interval the cross section
    is interpolated linearly in (ln E, ln sigma). No spline or line ever spans
    an edge, so values are never interpolated across a discontinuity.
  - At an edge energy the value *above* the edge (upper side) is returned.
    ``photoelectric_edge_sides`` gives both sides.

Exact XCOM boundary conditions for its splines are not published in the data
files; this implementation uses scipy's not-a-knot cubic spline. At every
tabulated energy the result equals the tabulated value exactly; between grid
points differences from the XCOM program are expected to be well below the
~1-2 % uncertainty of the underlying cross sections (see tests).
"""

from __future__ import annotations

import numpy as np
from scipy.interpolate import CubicSpline

# CODATA 2018 electron rest energy, MeV
ELECTRON_REST_ENERGY_MEV = 0.51099895000
PAIR_NUCLEAR_THRESHOLD_MEV = 2 * ELECTRON_REST_ENERGY_MEV
PAIR_ELECTRON_THRESHOLD_MEV = 4 * ELECTRON_REST_ENERGY_MEV

# Two grid energies closer than this (relative) are the two sides of an edge.
EDGE_PAIR_RTOL = 1e-5
EDGE_PAIR_ATOL = 1.5e-7  # MeV (XCOM stores edges as E and E + 1e-7 MeV)


def edge_pair_mask(energy: np.ndarray) -> np.ndarray:
    """Boolean mask, True for the *second* point of each edge pair."""
    d = np.diff(energy)
    second = np.zeros(energy.shape, dtype=bool)
    second[1:] = d < np.maximum(EDGE_PAIR_ATOL, EDGE_PAIR_RTOL * energy[:-1])
    return second


class LogLogSpline:
    """Cubic spline in (ln x, ln y); y must be > 0 at every node."""

    def __init__(self, x: np.ndarray, y: np.ndarray):
        if np.any(y <= 0):
            raise ValueError("log-log spline requires positive values")
        if np.any(np.diff(x) <= 0):
            raise ValueError("nodes must be strictly increasing")
        self.x0, self.x1 = float(x[0]), float(x[-1])
        self._cs = CubicSpline(np.log(x), np.log(y))

    def __call__(self, e: np.ndarray) -> np.ndarray:
        return np.exp(self._cs(np.log(e)))


class PairSpline:
    """Pair-production cross section with the threshold factor removed."""

    def __init__(self, energy: np.ndarray, sigma: np.ndarray, threshold: float):
        self.threshold = threshold
        keep = (energy > threshold) & (sigma > 0)
        e = energy[keep]
        if len(e) < 4:
            raise ValueError("not enough pair-production nodes")
        f = (1.0 - threshold / e) ** 3
        self._cs = CubicSpline(np.log(e), np.log(sigma[keep] / f))

    def __call__(self, e: np.ndarray) -> np.ndarray:
        e = np.asarray(e, dtype=float)
        out = np.zeros_like(e)
        above = e > self.threshold
        ea = e[above]
        out[above] = np.exp(self._cs(np.log(ea))) * (1.0 - self.threshold / ea) ** 3
        return out


class PhotoelectricInterpolator:
    """Edge-aware photoelectric interpolation (see module docstring)."""

    def __init__(self, energy: np.ndarray, sigma: np.ndarray, edges: list[dict], incomplete: list[dict]):
        self.edges = sorted(edges, key=lambda d: d["energy"])
        self.incomplete = {d["label"]: d for d in incomplete}
        if not self.edges:
            self.k_edge = None
            self._upper = LogLogSpline(*_dedupe(energy, sigma))
            self._upper_start = float(energy[0])
            self._intervals = []
            self.unavailable: list[tuple[float, float, str]] = []
            return
        k = self.edges[-1]  # highest edge is K
        self.k_edge = float(k["energy"])
        self.unavailable = []
        start = self.k_edge
        if k["label"] in self.incomplete:
            nxt = float(self.incomplete[k["label"]]["next_tabulated_energy"])
            self.unavailable.append((self.k_edge, nxt, k["label"]))
            start = nxt
        # Grid points at or above the (upper side of the) K edge.
        sel = energy >= start * (1 - 1e-12)
        e_up, s_up = energy[sel], sigma[sel]
        self._upper = LogLogSpline(*_dedupe(e_up, s_up, keep="first"))
        self._upper_start = float(e_up[0])
        # Intervals below K: (lo, hi, nodes_e, nodes_s). The data for edge X
        # covers the interval ending at X (lower-side value at its end).
        # Interval bounds are the edge energies themselves (interval node
        # energies are rounded in the data files).
        self._intervals = []
        lo = float(energy[0])
        for ed in self.edges:
            ie = np.asarray(ed["interval_energy"], dtype=float)
            ip = np.asarray(ed["interval_photoelectric"], dtype=float)
            self._intervals.append((lo, float(ed["energy"]), np.log(ie), np.log(ip)))
            lo = float(ed["energy"])
        for ed in self.edges[:-1]:
            if ed["label"] in self.incomplete:
                d = self.incomplete[ed["label"]]
                self.unavailable.append((float(d["edge_energy"]), float(d["next_tabulated_energy"]), ed["label"]))

    def __call__(self, e: np.ndarray) -> np.ndarray:
        e = np.asarray(e, dtype=float)
        out = np.full(e.shape, np.nan)
        if self.k_edge is None:
            return self._upper(e)
        up = e >= self._upper_start * (1 - 1e-12)
        out[up] = self._upper(e[up])
        for lo, hi, le, lp in self._intervals:
            # Energies exactly at an edge belong to the interval above it.
            m = (e >= lo * (1 - 1e-12)) & (e < hi * (1 - 1e-12)) & ~up
            if np.any(m):
                # np.interp is linear; applied to logs this is log-log linear.
                # Interval node energies are rounded to 5-7 digits in the data
                # files, so clamp to the interval.
                out[m] = np.exp(np.interp(np.log(e[m]), le, lp))
        for lo, hi, _ in self.unavailable:
            out[(e >= lo * (1 - 1e-12)) & (e < hi * (1 - 1e-12))] = np.nan
        return out


def _dedupe(e: np.ndarray, s: np.ndarray, keep: str = "last") -> tuple[np.ndarray, np.ndarray]:
    """Collapse edge-pair duplicates (energies ~1e-7 MeV apart)."""
    second = edge_pair_mask(e)
    if keep == "last":
        drop = np.zeros_like(second)
        drop[:-1] = second[1:]  # drop the first point of each pair
    else:
        drop = second
    return e[~drop], s[~drop]
