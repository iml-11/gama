import pytest

from science.formula_parser import FormulaError, parse_formula, plausibility_warnings


@pytest.mark.parametrize(
    "text,counts",
    [
        ("H2O", {"H": 2, "O": 1}),
        ("Bi2WO6", {"Bi": 2, "W": 1, "O": 6}),
        ("PbWO4", {"Pb": 1, "W": 1, "O": 4}),
        ("C10H8O4", {"C": 10, "H": 8, "O": 4}),
        ("Al2O3", {"Al": 2, "O": 3}),
        ("BaSO4", {"Ba": 1, "S": 1, "O": 4}),
        ("C8H8", {"C": 8, "H": 8}),
        ("Ca3(PO4)2", {"Ca": 3, "P": 2, "O": 8}),
        ("K4[Fe(CN)6]", {"K": 4, "Fe": 1, "C": 6, "N": 6}),
        ("CuSO4·5H2O", {"Cu": 1, "S": 1, "O": 9, "H": 10}),
        ("CuSO4*5H2O", {"Cu": 1, "S": 1, "O": 9, "H": 10}),
        ("Fe0.7Ni0.3", {"Fe": 0.7, "Ni": 0.3}),
        ("Co", {"Co": 1}),
        ("CO", {"C": 1, "O": 1}),
    ],
)
def test_parse_counts(text, counts):
    assert parse_formula(text).counts == pytest.approx(counts)


@pytest.mark.parametrize("text", ["(C5H8O2)n", "-(C5H8O2)-n", "[C5H8O2]n", "-(CH2C(CH3)(COOCH3))-n"])
def test_polymer_repeat_unit(text):
    p = parse_formula(text)
    assert p.is_repeat_unit
    assert p.counts == pytest.approx({"C": 5, "H": 8, "O": 2})


def test_hydrate_with_dot_warns():
    p = parse_formula("CaSO4.2H2O")
    assert p.counts == pytest.approx({"Ca": 1, "S": 1, "O": 6, "H": 4})
    assert any("hydrate" in w for w in p.warnings)


@pytest.mark.parametrize("bad", ["", "Xx2", "bi2O3", "H2O)", "(H2O", "2", "H0", "Fm2Uue", "Bi2 WO6 x"])
def test_invalid(bad):
    with pytest.raises(FormulaError):
        parse_formula(bad)


def test_charge_only_when_allowed():
    with pytest.raises(FormulaError):
        parse_formula("SO4^2-")
    p = parse_formula("O4W-2".replace("-2", "^2-"), allow_charge=True)
    assert p.charge == -2 and p.counts == pytest.approx({"O": 4, "W": 1})


def test_incomplete_formula_warning():
    p = parse_formula("Bi2WO")
    w = plausibility_warnings(p, {"Bi2WO6": "Bismuth tungstate"})
    assert any("incomplete" in x for x in w)
    assert any("charge-balanced" in x for x in w)


@pytest.mark.parametrize("ok", ["Bi2WO6", "PbWO4", "Al2O3", "Fe3O4", "H2O2", "BaSO4", "Bi2O3"])
def test_no_false_charge_warning(ok):
    assert plausibility_warnings(parse_formula(ok), {}) == []
