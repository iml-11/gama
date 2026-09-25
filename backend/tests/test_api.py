import math

import pytest
from fastapi.testclient import TestClient

from api.main import app

c = TestClient(app)


def test_health():
    j = c.get("/api/health").json()
    assert j["engine_configured"] is True


def test_calculate_with_density():
    r = c.post("/api/calculate", json={
        "material": {"input": "Pb", "online": False},
        "energies": [{"value": 1, "unit": "MeV"}],
        "density": {"value": 11.35, "source": "database"},
        "thickness": {"value": 10, "unit": "mm"},
    })
    assert r.status_code == 200
    row = r.json()["results"][0]
    mr = row["mass_attenuation"]["total_with_coherent"]
    assert mr == pytest.approx(0.07102, rel=6e-4)
    s = row["shielding"]
    assert s["mu_cm_inv"] == pytest.approx(11.35 * mr)
    assert s["hvl_cm"] == pytest.approx(math.log(2) / s["mu_cm_inv"])
    assert s["transmission"] == pytest.approx(math.exp(-s["mu_cm_inv"] * 1.0))
    d = r.json()["details"]
    assert "XCOM" in d["dataset"]["name"] and d["equations"]


def test_calculate_without_density_disables_linear():
    r = c.post("/api/calculate", json={"material": {"input": "PEEK", "online": False}, "energies": [{"value": 661.657, "unit": "keV"}]})
    j = r.json()
    assert j["density_dependent_enabled"] is False
    assert j["results"][0]["shielding"] is None
    assert j["results"][0]["mass_attenuation"]["total_with_coherent"] > 0


def test_unresolved_material_rejected():
    r = c.post("/api/calculate", json={"material": {"input": "epoxy", "online": False}, "energies": [{"value": 100, "unit": "keV"}]})
    assert r.status_code == 422
    assert r.json()["detail"]["resolution"]["status"] == "needs_choice"


def test_manual_composition():
    r = c.post("/api/calculate", json={"material": {"input": "edited", "composition": {"C": 62.5, "H": 4.2, "O": 33.3}},
                                       "energies": [{"value": 100, "unit": "keV"}]})
    assert r.status_code == 200
    bad = c.post("/api/calculate", json={"material": {"composition": {"C": 50, "H": 4.2}}, "energies": [{"value": 100, "unit": "keV"}]})
    assert bad.status_code == 422


def test_out_of_range_energy():
    r = c.post("/api/calculate", json={"material": {"input": "H2O", "online": False}, "energies": [{"value": 0.5, "unit": "keV"}]})
    assert r.status_code == 422 and "XCOM range" in r.json()["detail"]["message"]


def test_spectrum_and_compare():
    r = c.post("/api/spectrum", json={"material": {"input": "Bi2WO6", "online": False}, "e_min": {"value": 10, "unit": "keV"}, "e_max": {"value": 10, "unit": "MeV"}})
    j = r.json()
    assert r.status_code == 200 and any(e["label"] == "K" and e["element"] == "Bi" for e in j["edges"])
    r = c.post("/api/compare", json={
        "items": [{"material": {"input": "Pb", "online": False}, "density": {"value": 11.35}},
                  {"material": {"input": "Bi2WO6", "online": False}}],
        "energies": [{"value": 661.657, "unit": "keV"}],
        "e_min": {"value": 10, "unit": "keV"}, "e_max": {"value": 10, "unit": "MeV"}})
    j = r.json()
    assert j["linear_comparable"] is False and len(j["items"]) == 2


def test_experimental():
    r = c.post("/api/experimental", json={"material": {"input": "Pb", "online": False}, "energy_unit": "MeV",
                                          "density": {"value": 11.35},
                                          "points": [{"energy": 1.0, "mu_rho": 0.0710}, {"energy": 1.0, "mu": 0.8}]})
    j = r.json()
    p = j["points"][0]
    assert p["percent_difference"] == pytest.approx((0.0710 - p["xcom_mu_rho"]) / p["xcom_mu_rho"] * 100)
    assert j["points"][1]["exp_mu_rho_derived_from_mu"] is True


def test_isotopes_and_references():
    iso = {i["id"]: i for i in c.get("/api/isotopes").json()["isotopes"]}
    assert iso["Cs-137"]["lines"][0]["energy_keV"] == pytest.approx(661.657)
    assert {round(l["energy_keV"], 2) for l in iso["Co-60"]["lines"]} == {1173.23, 1332.49}
    refs = c.get("/api/references").json()["references"]
    assert any(i["id"] == "xcom" for t in refs for i in t["items"])


def test_custom_material_api():
    r = c.post("/api/custom-materials", json={"name": "Test resin", "mode": "elements", "mass_percent": {"C": 62.5, "H": 4.2, "O": 30}})
    assert r.status_code == 422 and "sum" in r.json()["detail"]["message"]
    r = c.post("/api/custom-materials", json={"name": "Test resin", "mode": "formula", "formula": "C10H8O4", "density": 1.3})
    assert r.status_code == 200
    mid = r.json()["id"]
    assert c.post("/api/resolve", json={"input": "test resin", "online": False}).json()["status"] == "resolved"
    assert c.delete(f"/api/custom-materials/{mid}").status_code == 200
