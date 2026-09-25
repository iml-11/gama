"""FastAPI layer. Contains no scientific logic: it validates requests, calls
``science.*`` and serialises results."""

from __future__ import annotations

import math
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from science import calculator, isotopes
from science import xcom_engine as xe
from science.composition import Composition, CompositionError
from science.material_db import get_db
from science.material_resolver import Resolution, resolve
from science.pubchem import get_client, online_enabled
from science.units import UnitError, energy_to_mev, length_to_cm

from .references import REFERENCES

app = FastAPI(title="Gamma Attenuation API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- models
class EnergyIn(BaseModel):
    value: float = Field(gt=0)
    unit: Literal["eV", "keV", "MeV", "GeV"] = "keV"
    label: str | None = None


class LengthIn(BaseModel):
    value: float = Field(ge=0)
    unit: Literal["um", "mm", "cm", "m"] = "cm"


class MaterialIn(BaseModel):
    input: str | None = None
    choices: dict[str, str] = Field(default_factory=dict)
    composition: dict[str, float] | None = Field(
        default=None, description="Manual elemental composition in wt% keyed by element symbol"
    )
    online: bool = True


class DensityIn(BaseModel):
    value: float | None = Field(default=None, gt=0)
    source: Literal["database", "user", "estimate"] = "user"


class CalculateIn(BaseModel):
    material: MaterialIn
    energies: list[EnergyIn] = Field(min_length=1, max_length=200)
    density: DensityIn | None = None
    thickness: LengthIn | None = None


class SpectrumIn(BaseModel):
    material: MaterialIn
    e_min: EnergyIn
    e_max: EnergyIn
    points: int = Field(default=300, ge=20, le=2000)


class TableIn(BaseModel):
    material: MaterialIn
    e_min: EnergyIn | None = None
    e_max: EnergyIn | None = None
    energies: list[EnergyIn] = Field(default_factory=list, max_length=500)
    density: DensityIn | None = None
    thickness: LengthIn | None = None


class CompareItem(BaseModel):
    material: MaterialIn
    density: DensityIn | None = None
    label: str | None = None


class CompareIn(BaseModel):
    items: list[CompareItem] = Field(min_length=1, max_length=8)
    energies: list[EnergyIn] = Field(default_factory=list, max_length=50)
    e_min: EnergyIn | None = None
    e_max: EnergyIn | None = None
    thickness: LengthIn | None = None
    points: int = Field(default=250, ge=20, le=1000)


class ExpPoint(BaseModel):
    energy: float = Field(gt=0)
    mu: float | None = Field(default=None, gt=0, description="Experimental linear attenuation coefficient, 1/cm")
    mu_rho: float | None = Field(default=None, gt=0, description="Experimental mass attenuation coefficient, cm2/g")
    uncertainty: float | None = Field(default=None, ge=0, description="Uncertainty of mu or mu/rho (same unit)")


class ExperimentalIn(BaseModel):
    material: MaterialIn
    energy_unit: Literal["eV", "keV", "MeV", "GeV"] = "keV"
    density: DensityIn | None = None
    points: list[ExpPoint] = Field(min_length=1, max_length=500)


class CustomMaterialIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    mode: Literal["formula", "elements"]
    formula: str | None = None
    mass_percent: dict[str, float] | None = None
    density: float | None = Field(default=None, gt=0)
    notes: str = ""
    reference: str | None = None


# --------------------------------------------------------------------------- helpers
def _engine_ready() -> bool:
    try:
        xe.manifest()
        return True
    except FileNotFoundError:
        return False


def _require_engine() -> None:
    if not _engine_ready():
        raise HTTPException(503, "Attenuation engine not yet configured")


def _material(m: MaterialIn) -> tuple[Resolution, Composition]:
    if m.composition:
        try:
            comp = Composition.from_mass_fractions({k: v / 100.0 for k, v in m.composition.items()}, tolerance=0.005)
        except (CompositionError, KeyError) as exc:
            raise HTTPException(422, {"message": str(exc)})
        res = Resolution(
            input=m.input or "custom composition",
            status="resolved",
            kind="manual",
            name=(m.input or "Custom composition") + " (user-edited composition)",
            composition=comp,
        )
        res.provenance.append({"item": "Composition", "source": "User-edited elemental mass fractions"})
        return res, comp
    if not m.input or not m.input.strip():
        raise HTTPException(422, {"message": "Please enter a material."})
    res = resolve(m.input, m.choices, online=m.online)
    if res.status != "resolved" or res.composition is None:
        raise HTTPException(422, {"message": "Material is not fully resolved.", "resolution": res.to_dict()})
    return res, res.composition


def _energies(items: list[EnergyIn]) -> list[float]:
    try:
        return [energy_to_mev(e.value, e.unit) for e in items]
    except UnitError as exc:
        raise HTTPException(422, {"message": str(exc)})


def _density_block(d: DensityIn | None) -> dict | None:
    if d is None or d.value is None:
        return None
    label = {"database": "Database value", "user": "User supplied value", "estimate": "Estimated value"}[d.source]
    return {"value": d.value, "source": d.source, "label": label}


def _xcom_guard(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except xe.XcomError as exc:
        raise HTTPException(422, {"message": str(exc)})


# --------------------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    return {"status": "ok", "engine_configured": _engine_ready(), "online_lookup": online_enabled()}


@app.get("/api/meta")
def meta():
    return {
        "engine_configured": _engine_ready(),
        "xcom": xe.dataset_info() if _engine_ready() else None,
        "isotopes": isotopes.dataset_info(),
        "online_lookup": online_enabled(),
        "energy_range_MeV": [xe.E_MIN_MEV, xe.E_MAX_MEV],
    }


@app.get("/api/search")
def search(q: str, online: bool = False, limit: int = 10):
    db = get_db()
    local = db.search(q, limit)
    remote: list[dict] = []
    if online and len(local) < limit:
        names = {i["name"].lower() for i in local}
        for term in get_client().autocomplete(q, limit=5):
            if term.lower() not in names:
                remote.append({"type": "pubchem", "id": f"pubchem:{term}", "name": term, "category": "PubChem", "match": term})
    for e in get_client().cached_entries():
        if q.lower() in e["query"].lower() and not any(i["name"].lower() == e["query"].lower() for i in local):
            local.append({"type": "pubchem_cache", "id": f"cache:{e['cid']}", "name": e["query"], "formula": e["formula"],
                          "category": "PubChem (cached)", "match": e["query"]})
    return {"results": (local + remote)[:limit]}


@app.post("/api/resolve")
def resolve_material(m: MaterialIn):
    if m.composition:
        res, _ = _material(m)
        return res.to_dict()
    return resolve(m.input or "", m.choices, online=m.online).to_dict()


@app.post("/api/calculate")
def calculate(body: CalculateIn):
    _require_engine()
    res, comp = _material(body.material)
    energies = _energies(body.energies)
    dens = _density_block(body.density)
    thickness_cm = length_to_cm(body.thickness.value, body.thickness.unit) if body.thickness else None
    rows = _xcom_guard(calculator.attenuation_at, comp, energies, dens["value"] if dens else None, thickness_cm)
    for row, e in zip(rows, body.energies):
        row["energy_input"] = e.model_dump()
    return {
        "material": res.to_dict(),
        "density": dens,
        "thickness": {"value": body.thickness.value, "unit": body.thickness.unit, "cm": thickness_cm} if body.thickness else None,
        "results": rows,
        "density_dependent_enabled": dens is not None,
        "details": calculator.calculation_details(comp),
    }


@app.post("/api/spectrum")
def spectrum(body: SpectrumIn):
    _require_engine()
    res, comp = _material(body.material)
    lo, hi = _energies([body.e_min, body.e_max])
    if hi <= lo:
        raise HTTPException(422, {"message": "The upper energy must be larger than the lower energy."})
    data = _xcom_guard(calculator.spectrum, comp, lo, hi, body.points)
    return {"material": res.to_dict(), **data}


@app.post("/api/table")
def table(body: TableIn):
    """Tabulated coefficients: XCOM standard grid + absorption edges in a range, or a custom energy list."""
    _require_engine()
    res, comp = _material(body.material)
    if body.energies:
        energies = _energies(body.energies)
        labels = [None] * len(energies)
    elif body.e_min and body.e_max:
        lo, hi = _energies([body.e_min, body.e_max])
        if hi <= lo:
            raise HTTPException(422, {"message": "The upper energy must be larger than the lower energy."})
        grid = _xcom_guard(xe.table_energies, list(comp.mass_fractions), max(lo, xe.E_MIN_MEV), min(hi, xe.E_MAX_MEV))
        energies = [g["energy_MeV"] for g in grid]
        labels = [g["edge"] for g in grid]
    else:
        raise HTTPException(422, {"message": "Give an energy range or a list of energies."})
    if not energies:
        raise HTTPException(422, {"message": "No XCOM grid energies in this range."})
    dens = _density_block(body.density)
    thickness_cm = length_to_cm(body.thickness.value, body.thickness.unit) if body.thickness else None
    rows = _xcom_guard(calculator.attenuation_at, comp, energies, dens["value"] if dens else None, thickness_cm)
    for row, label in zip(rows, labels):
        row["edge"] = label
    return {"material": res.to_dict(), "density": dens, "rows": rows, "details": calculator.calculation_details(comp)}


@app.post("/api/compare")
def compare(body: CompareIn):
    _require_engine()
    energies = _energies(body.energies) if body.energies else []
    thickness_cm = length_to_cm(body.thickness.value, body.thickness.unit) if body.thickness else None
    out = []
    for item in body.items:
        res, comp = _material(item.material)
        dens = _density_block(item.density)
        entry = {
            "label": item.label or res.name or res.input,
            "material": res.to_dict(),
            "density": dens,
            "at_energies": _xcom_guard(calculator.attenuation_at, comp, energies, dens["value"] if dens else None, thickness_cm) if energies else [],
        }
        if body.e_min and body.e_max:
            lo, hi = _energies([body.e_min, body.e_max])
            entry["spectrum"] = _xcom_guard(calculator.spectrum, comp, lo, hi, body.points)
        out.append(entry)
    all_dens = all(o["density"] is not None for o in out)
    return {
        "items": out,
        "linear_comparable": all_dens,
        "note": None if all_dens else "Linear quantities (mu, HVL, TVL, transmission) are only compared when every material has a density.",
    }


@app.post("/api/experimental")
def experimental(body: ExperimentalIn):
    _require_engine()
    res, comp = _material(body.material)
    dens = _density_block(body.density)
    energies = [energy_to_mev(p.energy, body.energy_unit) for p in body.points]
    rows = _xcom_guard(calculator.attenuation_at, comp, energies, dens["value"] if dens else None, None)
    points = []
    for p, row in zip(body.points, rows):
        th = row["mass_attenuation"]["total_with_coherent"]
        exp_mr = p.mu_rho
        derived = False
        if exp_mr is None and p.mu is not None:
            if not dens:
                raise HTTPException(422, {"message": "Experimental mu (1/cm) needs a density to compare with XCOM mu/rho."})
            exp_mr = p.mu / dens["value"]
            derived = True
        pt = {
            "energy": p.energy,
            "energy_MeV": row["energy_MeV"],
            "xcom_mu_rho": th,
            "xcom_mu": th * dens["value"] if (dens and th is not None) else None,
            "exp_mu_rho": exp_mr,
            "exp_mu": p.mu if p.mu is not None else (p.mu_rho * dens["value"] if (dens and p.mu_rho) else None),
            "exp_mu_rho_derived_from_mu": derived,
            "uncertainty": p.uncertainty,
        }
        if exp_mr is not None and th:
            pt["percent_difference"] = (exp_mr - th) / th * 100.0
            pt["relative_error"] = abs(exp_mr - th) / th
        else:
            pt["percent_difference"] = None
            pt["relative_error"] = None
        points.append(pt)
    diffs = [p["percent_difference"] for p in points if p["percent_difference"] is not None]
    summary = None
    if diffs:
        summary = {
            "n": len(diffs),
            "mean_percent_difference": sum(diffs) / len(diffs),
            "mean_absolute_percent_difference": sum(abs(d) for d in diffs) / len(diffs),
            "rms_percent_difference": math.sqrt(sum(d * d for d in diffs) / len(diffs)),
        }
    return {"material": res.to_dict(), "density": dens, "points": points, "summary": summary,
            "details": calculator.calculation_details(comp)}


@app.get("/api/isotopes")
def list_isotopes():
    return {"isotopes": isotopes.list_isotopes(), "dataset": isotopes.dataset_info()}


@app.get("/api/materials")
def list_materials(category: str | None = None):
    db = get_db()
    items = [e.summary() for e in db.entries.values() if category is None or e.category == category]
    items.sort(key=lambda e: ({"custom": 0, "curated": 1, "preset": 2, "element": 4, "nist_estar": 3}.get(e["source_kind"], 9), e["name"]))
    return {"materials": items, "families": [f.to_dict(db) for f in db.families.values()]}


@app.get("/api/materials/{mid}")
def material_detail(mid: str):
    db = get_db()
    if mid not in db.entries:
        raise HTTPException(404, "Material not found")
    return db.get(mid).to_dict()


@app.get("/api/custom-materials")
def list_custom():
    db = get_db()
    return {"materials": [e.to_dict() for e in db.entries.values() if e.source_kind == "custom"]}


@app.post("/api/custom-materials")
def create_custom(body: CustomMaterialIn):
    db = get_db()
    raw: dict = {"name": body.name, "notes": body.notes, "reference": body.reference, "density": body.density}
    if body.mode == "formula":
        if not body.formula:
            raise HTTPException(422, {"message": "Enter a formula."})
        raw["formula"] = body.formula
    else:
        if not body.mass_percent:
            raise HTTPException(422, {"message": "Enter the elemental composition."})
        total = sum(body.mass_percent.values())
        if abs(total - 100.0) > 0.5:
            raise HTTPException(422, {"message": f"Weight fractions sum to {total:.3f}%. They must sum to 100% (±0.5%)."})
        raw["mass_percent"] = body.mass_percent
    try:
        e = db.add_custom(raw)
    except Exception as exc:  # FormulaError, CompositionError, ValueError
        raise HTTPException(422, {"message": str(exc)})
    return e.to_dict()


@app.delete("/api/custom-materials/{mid}")
def delete_custom(mid: str):
    try:
        get_db().delete_custom(mid)
    except KeyError:
        raise HTTPException(404, "Custom material not found")
    return {"deleted": mid}


@app.get("/api/references")
def references():
    return {"references": REFERENCES}


@app.get("/api/units")
def units():
    return {"energy": ["eV", "keV", "MeV", "GeV"], "length": ["um", "mm", "cm", "m"]}
