import json

import httpx
import pytest

from science import pubchem
from science.composite_parser import CompositeError, parse_composite
from science.material_db import get_db
from science.material_resolver import resolve
from science.paths import ESTAR_FILE


def fr(r):
    return r.composition.mass_fractions


@pytest.mark.parametrize(
    "name,expected_id",
    [("PMMA", "pmma"), ("acrylic", "pmma"), ("polyethylene", "pe"), ("PE", "pe"), ("HDPE", "hdpe"), ("LDPE", "ldpe"),
     ("PET", "pet"), ("PVA", "pva"), ("PVC", "pvc"), ("PEEK", "peek"), ("PLA", "pla"), ("polystyrene", "ps"),
     ("water", "water"), ("bismuth tungstate", "bi2wo6"), ("bismuth wolframate", "bi2wo6")],
)
def test_named_materials(name, expected_id):
    r = resolve(name, online=False)
    assert r.status == "resolved"
    assert r.material["id"] == expected_id


def test_aliases_same_composition():
    a, b, c = resolve("Bi2WO6", online=False), resolve("bismuth tungstate", online=False), resolve("bismuth wolframate", online=False)
    for k in fr(a):
        assert fr(a)[k] == pytest.approx(fr(b)[k]) == pytest.approx(fr(c)[k])


@pytest.mark.parametrize("mid,estar", [("pe", 221), ("pmma", 223), ("pet", 222), ("pva", 230), ("pvc", 232), ("ps", 226), ("pc", 219), ("pp", 225), ("water", 276)])
def test_repeat_unit_matches_nist_composition(mid, estar):
    """Composition derived from the repeat unit agrees with the NIST table."""
    nist = {m["estar_id"]: m for m in json.loads(ESTAR_FILE.read_text())["materials"]}[estar]
    comp = get_db().get(mid).composition
    from science.elements import element

    for z, w in nist["mass_fractions"].items():
        assert comp.mass_fractions[element(int(z)).symbol] == pytest.approx(w, abs=2e-4)


def test_density_provenance():
    r = resolve("PMMA", online=False)
    assert r.density["value"] == 1.19 and "NIST" in r.density["source"]
    assert resolve("PEEK", online=False).density is None  # no sourced value -> blank
    assert resolve("HDPE", online=False).density is None


@pytest.mark.parametrize("name", ["epoxy", "concrete", "lead glass", "glass", "silicone", "resin"])
def test_ambiguous_needs_choice(name):
    r = resolve(name, online=False)
    assert r.status == "needs_choice"
    assert r.composition is None
    assert r.family["warning"]


def test_preset_choice():
    r = resolve("epoxy", {"epoxy": "epoxy-dgeba-deta"}, online=False)
    assert r.status == "resolved" and r.formula == "C113H146N6O20"


def test_alias_vs_formula_alternative():
    r = resolve("PVC", online=False)
    assert r.material["id"] == "pvc"
    assert r.alternatives and r.alternatives[0]["kind"] == "formula"


def test_formula_links_density():
    assert resolve("Al2O3", online=False).density["value"] == 3.97
    assert resolve("Pb", online=False).density["value"] == 11.35


def test_unknown_material_not_hallucinated():
    r = resolve("unobtainium", online=False)
    assert r.status == "not_found" and r.composition is None
    assert "could not be resolved" in r.errors[0]


# ---------------------------------------------------------------- composites
def test_composite_explicit():
    r = resolve("60 wt% Bi2WO6 + 40 wt% PMMA", online=False)
    assert r.status == "resolved"
    assert set(fr(r)) == {"Bi", "W", "O", "C", "H"}
    bwo = resolve("Bi2WO6", online=False)
    pm = resolve("PMMA", online=False)
    for k in fr(r):
        assert fr(r)[k] == pytest.approx(0.6 * fr(bwo).get(k, 0) + 0.4 * fr(pm).get(k, 0))
    assert sum(fr(r).values()) == pytest.approx(1)


@pytest.mark.parametrize(
    "text",
    ["60 wt% Bi2WO6 + 40 wt% epoxy", "Bi2WO6 epoxy composite with 60% filler", "60% Bi2WO6 + 40% epoxy",
     "epoxy composite with 60 wt% Bi2WO6", "Bi2WO6/epoxy 60/40", "40 wt% epoxy / Bi2WO6", "60 wt% Bi2WO6 in epoxy"],
)
def test_composite_forms_equivalent(text):
    ref = resolve("60 wt% Bi2WO6 + 40 wt% epoxy-dgeba", online=False)
    r = resolve(text, {"epoxy": "epoxy-dgeba"}, online=False)
    assert r.status == "resolved", r.errors
    for k in fr(ref):
        assert fr(r)[k] == pytest.approx(fr(ref)[k])


def test_composite_needs_choice_for_epoxy():
    r = resolve("30 wt% Bi2O3 / epoxy", online=False)
    assert r.status == "needs_choice"
    assert r.components[1]["percent"] == pytest.approx(70)


def test_composite_sum_error():
    r = resolve("60% Bi2WO6 + 50% epoxy", online=False)
    assert r.status == "error"
    assert "Component fractions total 110%" in r.errors[0]


def test_atomic_percent_rejected():
    with pytest.raises(CompositeError):
        parse_composite("60 at% W + 40 at% C")


def test_vol_percent_needs_densities():
    ok = resolve("20 vol% W + 80 vol% PMMA", online=False)
    assert ok.status == "resolved"
    w_mass = 0.2 * 19.3 / (0.2 * 19.3 + 0.8 * 1.19)
    assert fr(ok)["W"] == pytest.approx(w_mass)
    bad = resolve("20 vol% W + 80 vol% PEEK", online=False)
    assert bad.status == "error" and "density" in bad.errors[0]


def test_composite_density_is_only_an_estimate():
    r = resolve("60 wt% W + 40 wt% PMMA", online=False)
    assert r.density is None
    assert r.density_estimate["kind"] == "estimate"
    assert r.density_estimate["value"] == pytest.approx(1 / (0.6 / 19.3 + 0.4 / 1.19))


# ---------------------------------------------------------------- PubChem
def _mock_transport(calls):
    def handler(request: httpx.Request):
        calls.append(str(request.url))
        if "/name/bismuth%20tungstate/property" in str(request.url):
            return httpx.Response(200, json={"PropertyTable": {"Properties": [
                {"CID": 82601, "Title": "Bismuth tungstate", "IUPACName": "dibismuth;dioxido(dioxo)tungsten;oxygen(2-)",
                 "MolecularFormula": "Bi2O6W", "MolecularWeight": "697.8", "InChIKey": "X"}]}})
        if "/cid/82601/synonyms" in str(request.url):
            return httpx.Response(200, json={"InformationList": {"Information": [{"CID": 82601, "Synonym": ["Bismuth tungstate", "Bi2WO6"]}]}})
        if "/name/offline%20fail" in str(request.url):
            raise httpx.ConnectError("boom")
        return httpx.Response(404, json={"Fault": {}})
    return httpx.MockTransport(handler)


def test_pubchem_lookup_and_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("GAMMA_OFFLINE", "0")
    calls = []
    client = pubchem.PubChemClient(cache_file=tmp_path / "c.json", transport=_mock_transport(calls))
    pubchem.set_client(client)
    # bypass curated alias so the PubChem path is exercised
    r = resolve("Bismuth Tungstate", online=True)
    assert r.status == "resolved"  # curated alias match wins (case-insensitive)
    rec = client.lookup("bismuth tungstate")
    assert rec["cid"] == 82601 and rec["formula"] == "Bi2O6W"
    n = len(calls)
    rec2 = client.lookup("Bismuth  tungstate")
    assert rec2["from_cache"] and len(calls) == n
    cached = json.loads((tmp_path / "c.json").read_text())
    e = cached["entries"]["bismuth tungstate"]
    assert e["cid"] == 82601 and e["retrieved"] and e["source"] == "PubChem PUG REST"


def test_pubchem_resolution_provenance(tmp_path, monkeypatch):
    monkeypatch.setenv("GAMMA_OFFLINE", "0")
    calls = []
    client = pubchem.PubChemClient(cache_file=tmp_path / "c.json", transport=_mock_transport(calls))
    client._cache["entries"]["mystery tungstate"] = {
        "query": "mystery tungstate", "cid": 82601, "title": "Bismuth tungstate", "formula": "Bi2O6W",
        "molecular_weight": 697.8, "retrieved": "2026-01-01T00:00:00+00:00", "source": "PubChem PUG REST",
        "url": "https://pubchem.ncbi.nlm.nih.gov/compound/82601", "synonyms": [], "other_cids": []}
    pubchem.set_client(client)
    r = resolve("mystery tungstate", online=False)  # offline: served from cache
    assert r.status == "resolved" and r.kind == "pubchem"
    assert any("PubChem CID 82601" in p["source"] for p in r.provenance)
    ref = resolve("Bi2WO6", online=False)
    for k in fr(ref):
        assert fr(r)[k] == pytest.approx(fr(ref)[k])


def test_pubchem_failure_not_invented(tmp_path, monkeypatch):
    monkeypatch.setenv("GAMMA_OFFLINE", "0")
    client = pubchem.PubChemClient(cache_file=tmp_path / "c.json", transport=_mock_transport([]))
    pubchem.set_client(client)
    r = resolve("offline fail", online=True)
    assert r.status == "not_found" and r.composition is None
    assert any("Online lookup failed" in w for w in r.warnings)
    r2 = resolve("no such compound xyz", online=True)
    assert r2.status == "not_found"


def test_search_autocomplete():
    db = get_db()
    names = [x["name"] for x in db.search("poly", 20)]
    for n in ["Polyethylene", "Polypropylene", "Polystyrene"]:
        assert n in names
    assert any("carbonate" in n for n in names)
    assert db.search("PM")[0]["id"] == "pmma"
    bism = [x["name"] for x in db.search("bism")]
    assert bism[:3] == ["Bismuth", "Bismuth tungstate", "Bismuth(III) oxide"] or set(bism[:3]) == {"Bismuth", "Bismuth tungstate", "Bismuth(III) oxide"}


def test_custom_materials():
    db = get_db()
    e = db.add_custom({"name": "My PEN", "formula": "C14H10O4", "density": 1.36, "notes": "test"})
    assert e.density.kind == "user"
    assert resolve("my pen", online=False).material["id"] == e.id
    e2 = db.add_custom({"name": "Mix A", "mass_percent": {"C": 62.5, "H": 4.2, "O": 33.3}})
    assert sum(e2.composition.mass_fractions.values()) == pytest.approx(1)
    with pytest.raises(Exception):
        db.add_custom({"name": "Bad", "mass_percent": {"C": 50, "H": 10}})
    with pytest.raises(ValueError):
        db.add_custom({"name": "PMMA", "formula": "C5H8O2"})
    db.delete_custom(e.id)
    assert resolve("my pen", online=False).status == "not_found"
