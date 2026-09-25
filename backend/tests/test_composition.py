import pytest

from science.composition import Composition, CompositionError
from science.elements import element


def M(s):
    return element(s).atomic_weight


def test_bi2wo6_molar_mass_and_fractions():
    c = Composition.from_counts({"Bi": 2, "W": 1, "O": 6})
    molar = 2 * M("Bi") + M("W") + 6 * M("O")
    assert c.molar_mass == pytest.approx(molar)
    assert c.molar_mass == pytest.approx(697.79, abs=0.01)
    assert c.mass_fractions["Bi"] == pytest.approx(2 * M("Bi") / molar)
    assert c.mass_fractions["W"] == pytest.approx(M("W") / molar)
    assert c.mass_fractions["O"] == pytest.approx(6 * M("O") / molar)
    assert sum(c.mass_fractions.values()) == pytest.approx(1.0, abs=1e-12)


def test_water():
    c = Composition.from_counts({"H": 2, "O": 1})
    assert c.molar_mass == pytest.approx(18.015, abs=1e-3)
    assert c.mass_fractions["H"] == pytest.approx(0.11190, abs=5e-5)


def test_repeat_unit_independent_of_n():
    a = Composition.from_counts({"C": 5, "H": 8, "O": 2})
    b = Composition.from_counts({"C": 500, "H": 800, "O": 200})
    for k in a.mass_fractions:
        assert a.mass_fractions[k] == pytest.approx(b.mass_fractions[k], rel=1e-12)


def test_mix_by_mass():
    bwo = Composition.from_counts({"Bi": 2, "W": 1, "O": 6})
    pmma = Composition.from_counts({"C": 5, "H": 8, "O": 2})
    mix = Composition.mix([(bwo, 0.6), (pmma, 0.4)])
    assert set(mix.mass_fractions) == {"Bi", "W", "O", "C", "H"}
    assert mix.mass_fractions["Bi"] == pytest.approx(0.6 * bwo.mass_fractions["Bi"])
    assert mix.mass_fractions["O"] == pytest.approx(0.6 * bwo.mass_fractions["O"] + 0.4 * pmma.mass_fractions["O"])
    assert sum(mix.mass_fractions.values()) == pytest.approx(1.0)


def test_mix_requires_sum_one():
    a = Composition.from_counts({"H": 2, "O": 1})
    with pytest.raises(CompositionError):
        Composition.mix([(a, 0.6), (a, 0.5)])


def test_mass_fraction_input_validation():
    with pytest.raises(CompositionError):
        Composition.from_mass_fractions({"C": 0.6, "H": 0.3})
    c = Composition.from_mass_fractions({"C": 0.625, "H": 0.042, "O": 0.333})
    assert sum(c.mass_fractions.values()) == pytest.approx(1)


def test_atom_vs_mass_fractions_not_mixed():
    c = Composition.from_counts({"H": 2, "O": 1})
    af = c.atom_fractions()
    assert af["H"] == pytest.approx(2 / 3)
    assert c.mass_fractions["H"] != pytest.approx(2 / 3)
