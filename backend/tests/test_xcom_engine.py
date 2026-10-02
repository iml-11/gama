"""Tests of the XCOM engine.

Reference values
----------------
NIST_REFERENCE: total mass attenuation coefficients (with coherent
scattering) published by NIST (Hubbell & Seltzer, NISTIR 5632 / NIST SRD 126,
which tabulates XCOM cross sections) at standard grid energies. They are
reproduced to the 4 significant digits of the tables.

GRID tests: at every tabulated XCOM energy the engine must return exactly the
tabulated XCOM cross section (these *are* the official XCOM values).
"""

import json

import numpy as np
import pytest

from science import xcom_engine as xe
from science.composition import Composition
from science.paths import XCOM_DIR

NIST_REFERENCE = [
    # (material, energy MeV, mu/rho cm2/g)
    ("Pb", 0.1, 5.549),
    ("Pb", 0.5, 0.1614),
    ("Pb", 1.0, 0.07102),
    ("Fe", 1.0, 0.05995),
    ("Al", 1.0, 0.06146),
    ("H2O", 1.0, 0.07072),
]


@pytest.mark.parametrize("formula,e,ref", NIST_REFERENCE)
def test_published_nist_values(formula, e, ref):
    from science.formula_parser import parse_formula

    comp = Composition.from_counts(parse_formula(formula).counts)
    val = xe.mixture_mass_attenuation(comp.mass_fractions, [e])["total_with_coherent"][0]
    assert val == pytest.approx(ref, rel=6e-4)


@pytest.mark.parametrize("z", [1, 6, 8, 13, 26, 29, 50, 64, 74, 82, 83, 92])
def test_grid_points_exact(z):
    d = json.loads((XCOM_DIR / f"Z{z:03d}.json").read_text())
    e = np.array(d["energy"])
    cs = xe.cross_sections(z, e)
    for p in xe.PROCESSES:
        np.testing.assert_allclose(cs[p], d[p], rtol=1e-12, atol=0, err_msg=p)


def _between_grid(z):
    d = json.loads((XCOM_DIR / f"Z{z:03d}.json").read_text())
    e = np.array(d["energy"])
    mids = np.sqrt(e[:-1] * e[1:])
    keep = np.diff(e) > 1e-5 * e[:-1]  # skip edge pairs
    return d, e, mids[keep], np.nonzero(keep)[0]


@pytest.mark.parametrize("z", [6, 8, 26, 74, 82, 83])
@pytest.mark.parametrize("process", ["coherent", "incoherent"])
def test_scattering_interpolation_bracketed(z, process):
    """Between neighbouring grid points the value lies between the node values
    (these cross sections are monotonic between adjacent grid points)."""
    d, e, mids, idx = _between_grid(z)
    v = xe.cross_sections(z, mids)[process]
    lo = np.minimum(np.array(d[process])[idx], np.array(d[process])[idx + 1])
    hi = np.maximum(np.array(d[process])[idx], np.array(d[process])[idx + 1])
    assert np.all(v >= lo * (1 - 2e-3)) and np.all(v <= hi * (1 + 2e-3))


@pytest.mark.parametrize("z", [74, 82, 83])
def test_photoelectric_between_grid_points_monotonic(z):
    d, e, mids, idx = _between_grid(z)
    v = xe.cross_sections(z, mids)["photoelectric"]
    a, b = np.array(d["photoelectric"])[idx], np.array(d["photoelectric"])[idx + 1]
    assert np.all(v <= np.maximum(a, b) * (1 + 1e-3))
    assert np.all(v >= np.minimum(a, b) * (1 - 1e-3))


# K and L edges (MeV), from the XCOM data files themselves.
EDGES = {
    "W": (74, ["K", "L1", "L2", "L3"]),
    "Pb": (82, ["K", "L1", "L2", "L3"]),
    "Bi": (83, ["K", "L1", "L2", "L3"]),
}


def _edge(z, label):
    d = json.loads((XCOM_DIR / f"Z{z:03d}.json").read_text())
    return next(x for x in d["edges"] if x["label"] == label)


@pytest.mark.parametrize("sym", EDGES)
def test_edges_jump_and_sides(sym):
    z, labels = EDGES[sym]
    for label in labels:
        edge = _edge(z, label)
        E = edge["energy"]
        below = E * (1 - 1e-6)
        at = E
        cs = xe.cross_sections(z, [below, at])
        pe = cs["photoelectric"]
        # Photoelectric jumps up at the edge.
        assert pe[1] > 1.05 * pe[0], (sym, label)
        # Value just below equals the tabulated lower-side value.
        assert pe[0] == pytest.approx(edge["interval_photoelectric"][-1], rel=1e-4)
        # Scattering is continuous across the edge.
        assert cs["coherent"][1] == pytest.approx(cs["coherent"][0], rel=1e-5)
        assert cs["incoherent"][1] == pytest.approx(cs["incoherent"][0], rel=1e-5)


def test_pb_k_edge_values():
    # XCOM tabulates Pb K edge at 88.0045 keV: 532.4 b below, 2519 b above.
    cs = xe.cross_sections(82, [0.0880044, 0.0880045])["photoelectric"]
    assert cs[0] == pytest.approx(532.4)
    assert cs[1] == pytest.approx(2519.0)


@pytest.mark.parametrize("sym", EDGES)
def test_no_interpolation_across_edges(sym):
    """Just above each edge the value must be close to the upper-side node,
    just below close to the lower-side node: no smearing over the jump."""
    z, labels = EDGES[sym]
    for label in labels:
        E = _edge(z, label)["energy"]
        pe = xe.cross_sections(z, [E * (1 - 1e-4), E, E * (1 + 1e-4)])["photoelectric"]
        assert pe[0] < pe[1]
        assert abs(pe[2] / pe[1] - 1) < 5e-3
        assert pe[2] > pe[0] * 1.05


def test_l3_interval_uses_log_log():
    """Inside the Pb L3 interval, value at the geometric mean of two nodes equals
    the geometric mean of the node values (log-log linear)."""
    ed = _edge(82, "L3")
    e1, e2 = ed["interval_energy"][1], ed["interval_energy"][2]
    s1, s2 = ed["interval_photoelectric"][1], ed["interval_photoelectric"][2]
    v = xe.cross_sections(82, [np.sqrt(e1 * e2)])["photoelectric"][0]
    assert v == pytest.approx(np.sqrt(s1 * s2), rel=1e-9)


def test_pair_thresholds():
    cs = xe.cross_sections(82, [1.0, 1.02, 1.5, 2.0, 2.5])
    assert cs["pair_nuclear"][0] == 0 and cs["pair_nuclear"][1] == 0
    assert cs["pair_nuclear"][2] > 0
    assert cs["pair_electron"][3] == 0
    assert cs["pair_electron"][4] > 0
    # increases with energy above threshold
    e = np.geomspace(1.03, 100, 60)
    assert np.all(np.diff(xe.cross_sections(82, e)["pair_nuclear"]) > 0)


def test_totals_consistent():
    r = xe.element_mass_attenuation(83, [0.661657])
    assert r["total_with_coherent"][0] == pytest.approx(
        sum(r[p][0] for p in xe.PROCESSES)
    )
    assert r["total_without_coherent"][0] == pytest.approx(r["total_with_coherent"][0] - r["coherent"][0])


def test_mixture_rule():
    c = Composition.from_counts({"Bi": 2, "W": 1, "O": 6})
    e = [0.05, 0.661657, 1.25]
    mix = xe.mixture_mass_attenuation(c.mass_fractions, e)["total_with_coherent"]
    manual = sum(
        w * xe.element_mass_attenuation(z, e)["total_with_coherent"]
        for z, w in [(83, c.mass_fractions["Bi"]), (74, c.mass_fractions["W"]), (8, c.mass_fractions["O"])]
    )
    np.testing.assert_allclose(mix, manual, rtol=1e-12)


@pytest.mark.parametrize("e", [0.0009, 1.1e5, float("nan")])
def test_energy_out_of_range(e):
    with pytest.raises(xe.XcomError):
        xe.element_mass_attenuation(82, [e])


def test_incomplete_edge_refused():
    """For Z = 87-100 the source conversion lacks the value just above the K edge:
    the engine must return NaN (unavailable) there, not a guess."""
    d = json.loads((XCOM_DIR / "Z092.json").read_text())
    miss = d["incomplete_edges"][0]
    mid = (miss["edge_energy"] + miss["next_tabulated_energy"]) / 2
    r = xe.element_mass_attenuation(92, [mid, miss["next_tabulated_energy"]])
    assert np.isnan(r["photoelectric"][0]) and np.isnan(r["total_with_coherent"][0])
    assert np.isfinite(r["total_with_coherent"][1])


def test_plot_grid_contains_both_edge_sides():
    g = xe.plot_grid(["Pb"], 0.01, 1.0, 100)
    E = _edge(82, "K")["energy"]
    assert E in g and np.any((g < E) & (g > E * (1 - 1e-6)))
