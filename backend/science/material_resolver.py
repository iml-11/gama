"""Material resolver: text -> elemental composition, with provenance.

Resolution order for a single material
--------------------------------------
1. User custom materials (exact name).
2. Exact name/alias match in the local database (curated materials and
   presets, ambiguous families, elements, NIST ESTAR materials). Curated
   entries are checked before PubChem because PubChem does not give reliable
   attenuation-ready compositions for polymers, resins, glasses and other
   formulated materials. Ambiguous families (epoxy, concrete, glass...) never
   resolve to a single composition: the caller must pick a preset.
3. Direct chemical formula parse (Bi2WO6, (C5H8O2)n, CuSO4·5H2O).
4. Local PubChem cache.
5. PubChem PUG REST (online mode only), cached on success.
6. Not found: suggestions from the local database; nothing is guessed.

If a string is both an alias and a valid formula (e.g. "PVC", "PLA", "PS"),
the alias wins and the formula reading is offered as an alternative.

Composite descriptions are split by :mod:`science.composite_parser` and each
component is resolved with the same procedure; fractions are mass fractions
(vol% is converted only when every component has a density).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .composite_parser import (
    CompositeError,
    ComponentSpec,
    complete_fractions,
    looks_composite,
    parse_composite,
)
from .composition import Composition, CompositionError
from .formula_parser import FormulaError, looks_like_formula, parse_formula, plausibility_warnings
from .material_db import MaterialDB, MaterialEntry, get_db
from .pubchem import PubChemUnavailable, get_client

MATRIX_CATEGORIES = {"polymer", "resin", "elastomer"}
MATRIX_FAMILIES = {"epoxy", "silicone"}


@dataclass
class Resolution:
    input: str
    status: str  # resolved | needs_choice | not_found | error
    kind: str | None = None  # formula | material | pubchem | composite | family
    name: str | None = None
    composition: Composition | None = None
    density: dict | None = None  # suggested density {value, source, kind}
    density_estimate: dict | None = None  # derived (e.g. ideal mixture), never auto-applied
    material: dict | None = None
    pubchem: dict | None = None
    formula: str | None = None
    repeat_unit: bool = False
    components: list[dict] = field(default_factory=list)
    family: dict | None = None
    alternatives: list[dict] = field(default_factory=list)
    suggestions: list[dict] = field(default_factory=list)
    provenance: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    category: str | None = None

    def to_dict(self) -> dict:
        return {
            "input": self.input,
            "status": self.status,
            "kind": self.kind,
            "name": self.name,
            "category": self.category,
            "formula": self.formula,
            "repeat_unit": self.repeat_unit,
            "composition": self.composition.to_dict() if self.composition else None,
            "density": self.density,
            "density_estimate": self.density_estimate,
            "material": self.material,
            "pubchem": self.pubchem,
            "components": self.components,
            "family": self.family,
            "alternatives": self.alternatives,
            "suggestions": self.suggestions,
            "provenance": self.provenance,
            "warnings": self.warnings,
            "errors": self.errors,
            "steps": self.steps,
        }


# ----------------------------------------------------------------------------
def _from_entry(text: str, e: MaterialEntry, db: MaterialDB) -> Resolution:
    r = Resolution(input=text, status="resolved", kind="material", name=e.name, composition=e.composition)
    r.material = e.summary()
    r.formula = e.formula
    r.repeat_unit = e.repeat_unit
    r.category = e.category
    r.steps.append(f"Matched '{text}' to {e.name} ({_kind_label(e.source_kind)})")
    r.provenance.append({"item": "Composition", "source": e.composition_source or _kind_label(e.source_kind)})
    if e.repeat_unit:
        r.steps.append(f"Repeat unit {e.formula}: elemental fractions are independent of chain length")
    if e.density:
        r.density = e.density.to_dict()
        r.provenance.append({"item": "Density", "source": e.density.source})
    else:
        r.provenance.append({"item": "Density", "source": "Not available in the database – user value required"})
    if e.notes:
        r.warnings.append(e.notes) if e.confidence in ("medium", "low") else None
    return r


def _kind_label(kind: str) -> str:
    return {
        "curated": "curated material database",
        "preset": "curated composition preset",
        "nist_estar": "NIST ESTAR material table",
        "element": "element",
        "custom": "user custom material",
    }.get(kind, kind)


def _from_formula(text: str, db: MaterialDB) -> Resolution:
    parsed = parse_formula(text)
    comp = Composition.from_counts(parsed.counts, formula=parsed.display)
    r = Resolution(input=text, status="resolved", kind="formula", composition=comp)
    r.formula = parsed.display
    r.repeat_unit = parsed.is_repeat_unit
    r.name = parsed.display
    r.warnings += parsed.warnings
    r.warnings += plausibility_warnings(parsed, db.known_formulas())
    r.steps.append("Chemical formula parsed")
    if parsed.is_repeat_unit:
        r.steps.append("Polymer repeat unit: elemental fractions are independent of chain length n")
    r.steps.append("Elemental mass fractions calculated from IUPAC 2021 atomic weights")
    r.provenance.append({"item": "Composition", "source": f"Stoichiometry of {parsed.normalized} with IUPAC 2021 standard atomic weights"})
    # Link to a database entry with identical composition (for name/density).
    if len(parsed.counts) == 1 and list(parsed.counts.values())[0] == 1:
        e = db.element_entry(next(iter(parsed.counts)))
        r.name = e.name
        r.material = e.summary()
        r.category = "element"
        if e.density:
            r.density = e.density.to_dict()
            r.provenance.append({"item": "Density", "source": e.density.source})
    elif not parsed.is_repeat_unit:
        matches = [e for e in db.same_composition(comp) if e.source_kind != "element"]
        named = [e for e in matches if e.source_kind in ("curated", "preset")] or matches
        if named:
            e = named[0]
            r.name = e.name
            r.material = e.summary()
            r.category = e.category
            r.steps.append(f"Same composition as database entry '{e.name}'")
            dens = [m for m in matches if m.density]
            if dens:
                r.density = dens[0].density.to_dict()
                r.provenance.append(
                    {"item": "Density", "source": f"{dens[0].density.source} (database entry with identical composition)"}
                )
    if not r.density:
        r.provenance.append({"item": "Density", "source": "Not available – user value required for linear quantities"})
    return r


def _from_pubchem(text: str, rec: dict, db: MaterialDB) -> Resolution:
    parsed = parse_formula(rec["formula"], allow_charge=True)
    comp = Composition.from_counts(parsed.counts, formula=parsed.normalized)
    r = Resolution(input=text, status="resolved", kind="pubchem", composition=comp)
    r.name = rec.get("title") or text
    r.formula = parsed.normalized
    r.pubchem = rec
    r.category = "compound"
    r.warnings += parsed.warnings
    src = "local PubChem cache" if rec.get("from_cache") else "PubChem (online)"
    r.steps.append(f"Resolved '{text}' via {src}: CID {rec['cid']}, {rec['formula']}")
    r.steps.append("Elemental mass fractions calculated from IUPAC 2021 atomic weights")
    r.provenance.append(
        {"item": "Chemical identity", "source": f"PubChem CID {rec['cid']} (retrieved {rec['retrieved'][:10]})", "url": rec.get("url")}
    )
    r.provenance.append({"item": "Molecular formula", "source": f"PubChem CID {rec['cid']}"})
    if rec.get("molecular_weight") and comp.molar_mass:
        rel = abs(rec["molecular_weight"] - comp.molar_mass) / rec["molecular_weight"]
        if rel > 5e-3:
            r.warnings.append(
                f"PubChem molecular weight ({rec['molecular_weight']:.3f}) differs from the value computed "
                f"from the formula ({comp.molar_mass:.3f}) by {rel * 100:.2f}%. Check the compound."
            )
    if rec.get("other_cids"):
        r.warnings.append(
            f"PubChem returned several compounds for '{text}'; using CID {rec['cid']} ({rec['formula']}). "
            "Enter the formula directly if this is not the intended compound."
        )
    matches = db.same_composition(comp)
    dens = [m for m in matches if m.density and m.source_kind != "element"]
    if dens:
        r.density = dens[0].density.to_dict()
        r.provenance.append({"item": "Density", "source": f"{dens[0].density.source} (database entry with identical composition)"})
    else:
        r.provenance.append({"item": "Density", "source": "Not provided by PubChem – user value required"})
    return r


def _not_found(text: str, db: MaterialDB, reason: str | None = None) -> Resolution:
    r = Resolution(input=text, status="not_found")
    r.errors.append("Material could not be resolved automatically." if not reason else reason)
    r.suggestions = db.search(text, 6)
    if not r.suggestions:
        words = [w for w in re.split(r"\s+", text) if len(w) >= 3]
        for w in words:
            r.suggestions += db.search(w, 3)
    return r


def resolve_single(text: str, choices: dict[str, str] | None = None, online: bool = True, db: MaterialDB | None = None) -> Resolution:
    db = db or get_db()
    choices = {k.strip().lower(): v for k, v in (choices or {}).items()}
    t = text.strip()
    if not t:
        return Resolution(input=text, status="error", errors=["Please enter a material."])

    # Explicit "formula:" prefix forces the chemical-formula reading.
    if t.lower().startswith("formula:"):
        try:
            return _from_formula(t.split(":", 1)[1].strip(), db)
        except (FormulaError, CompositionError) as exc:
            return Resolution(input=t, status="error", errors=[f"Not a valid chemical formula: {exc}"])

    # Explicit preset / material id chosen by the user.
    chosen = choices.get(t.lower())
    if chosen:
        if chosen in db.entries:
            return _from_entry(t, db.get(chosen), db)
        return Resolution(input=t, status="error", errors=[f"Unknown preset '{chosen}'."])
    if t in db.entries:  # direct id reference, e.g. "epoxy-dgeba-deta"
        return _from_entry(t, db.get(t), db)

    formula_res: Resolution | None = None
    formula_err: str | None = None
    if looks_like_formula(t):
        try:
            formula_res = _from_formula(t, db)
        except (FormulaError, CompositionError) as exc:
            formula_err = str(exc)

    hit = db.lookup_exact(t)
    if hit:
        kind, obj = hit
        if kind == "family":
            r = Resolution(input=t, status="needs_choice", kind="family", name=obj.name)
            r.family = obj.to_dict(db)
            r.warnings.append(obj.warning)
            r.steps.append(f"'{t}' has no single universal composition – choose a preset")
        else:
            r = _from_entry(t, obj, db)
        if formula_res is not None:
            r.alternatives.append(
                {"label": f"Chemical formula {formula_res.formula}", "input": f"formula:{formula_res.formula}", "kind": "formula"}
            )
        return r

    if formula_res is not None:
        return formula_res

    client = get_client()
    cached = client.cached(t)
    if cached:
        try:
            return _from_pubchem(t, {**cached, "from_cache": True}, db)
        except (FormulaError, CompositionError) as exc:
            return Resolution(input=t, status="error", errors=[f"PubChem formula could not be parsed: {exc}"])

    pubchem_reason = None
    if online:
        try:
            rec = client.lookup(t, online=True)
            if rec:
                return _from_pubchem(t, rec, db)
        except PubChemUnavailable as exc:
            pubchem_reason = f"Online lookup failed ({exc})."
        except (FormulaError, CompositionError) as exc:
            return Resolution(input=t, status="error", errors=[f"PubChem formula could not be parsed: {exc}"])

    r = _not_found(t, db)
    if formula_err and re.search(r"\d", t):
        r.errors.append(f"Not a valid chemical formula: {formula_err}")
    if pubchem_reason:
        r.warnings.append(pubchem_reason)
    elif not online:
        r.warnings.append("Offline mode: PubChem was not queried.")
    return r


# ----------------------------------------------------------------------------
def _is_matrix(r: Resolution) -> bool:
    if r.kind == "family" and r.family and r.family["id"] in MATRIX_FAMILIES:
        return True
    return (r.category or "") in MATRIX_CATEGORIES


def _split_pair(pre: str, choices, online, db) -> tuple[Resolution, Resolution]:
    """Split 'Bi2WO6 epoxy' / 'Bi2WO6 / epoxy' into two resolvable parts."""
    if " / " in pre:
        a, b = pre.split(" / ", 1)
        return resolve_single(a, choices, online, db), resolve_single(b, choices, online, db)
    words = pre.split()
    ok = []
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        ra, rb = resolve_single(a, choices, online=False, db=db), resolve_single(b, choices, online=False, db=db)
        if ra.status in ("resolved", "needs_choice") and rb.status in ("resolved", "needs_choice"):
            ok.append((ra, rb))
    if len(ok) == 1:
        return ok[0]
    if not ok and len(words) == 2 and online:
        return resolve_single(words[0], choices, online, db), resolve_single(words[1], choices, online, db)
    raise CompositeError(
        f"Could not identify the two components in '{pre}'. Use explicit fractions, e.g. '60 wt% A + 40 wt% B'."
    )


def resolve(text: str, choices: dict[str, str] | None = None, online: bool = True) -> Resolution:
    db = get_db()
    t = (text or "").strip()
    if not t:
        return Resolution(input=text or "", status="error", errors=["Please enter a material."])
    # Whole-string match first (e.g. aliases containing '/').
    if t.lower().startswith("formula:") or db.lookup_exact(t) or t in db.entries or (choices and t.lower() in {k.lower() for k in choices}):
        return resolve_single(t, choices, online, db)
    if not looks_composite(t):
        return resolve_single(t, choices, online, db)
    try:
        spec = parse_composite(t)
    except CompositeError as exc:
        return Resolution(input=t, status="error", kind="composite", errors=[str(exc)])

    try:
        if spec.style == "filler_unknown":
            ra, rb = _split_pair(spec.ambiguous_pair, choices, online, db)
            ma, mb = _is_matrix(ra), _is_matrix(rb)
            if ma == mb:
                raise CompositeError(
                    f"Cannot tell which of '{ra.input}' and '{rb.input}' is the filler. "
                    f"Write e.g. '{spec.filler_percent:g} wt% {ra.input} + {100 - spec.filler_percent:g} wt% {rb.input}'."
                )
            filler, matrix = (rb, ra) if ma else (ra, rb)
            comps = [
                ComponentSpec(filler.input, spec.filler_percent, spec.filler_basis, "filler"),
                ComponentSpec(matrix.input, None, spec.filler_basis, "matrix"),
            ]
            resolved = [filler, matrix]
            spec.warnings.append(f"Identified '{filler.input}' as the filler and '{matrix.input}' as the matrix.")
        else:
            comps = spec.components
            resolved = [resolve_single(c.text, choices, online, db) for c in comps]
        fractions = complete_fractions(comps)
    except CompositeError as exc:
        return Resolution(input=t, status="error", kind="composite", errors=[str(exc)])

    r = Resolution(input=t, status="resolved", kind="composite")
    r.warnings += spec.warnings
    r.steps.append(f"Composite with {len(comps)} components recognised")
    for c, res, f in zip(comps, resolved, fractions):
        r.components.append({"text": c.text, "percent": f * 100, "basis": c.basis, "role": c.role, "resolution": res.to_dict()})
    bad = [res for res in resolved if res.status in ("not_found", "error")]
    pending = [res for res in resolved if res.status == "needs_choice"]
    if bad:
        r.status = "error"
        for res in bad:
            r.errors.append(f"Component '{res.input}': " + " ".join(res.errors or ["could not be resolved."]))
        return r
    if pending:
        r.status = "needs_choice"
        for res in pending:
            r.warnings.append(f"Component '{res.input}': choose a composition preset.")
        return r

    basis = comps[0].basis
    if basis == "vol":
        dens = [res.density["value"] if res.density else None for res in resolved]
        if any(d is None for d in dens):
            missing = [res.input for res, d in zip(resolved, dens) if d is None]
            r.status = "error"
            r.errors.append(
                "vol% needs a density for every component; no database density for: "
                + ", ".join(missing)
                + ". Use wt% or define custom materials with densities."
            )
            return r
        masses = [f * d for f, d in zip(fractions, dens)]
        tot = sum(masses)
        wfr = [m / tot for m in masses]
        r.steps.append("Volume fractions converted to mass fractions: w_i = φ_i ρ_i / Σ φ_j ρ_j")
        for c, w in zip(r.components, wfr):
            c["mass_percent"] = w * 100
        rho_mix = sum(f * d for f, d in zip(fractions, dens))
        r.density_estimate = {
            "value": rho_mix,
            "source": "Estimated: ρ = Σ φ_i ρ_i (ideal mixture, zero porosity)",
            "kind": "estimate",
        }
    else:
        tot = sum(fractions)
        wfr = [f / tot for f in fractions]
        for c, w in zip(r.components, wfr):
            c["mass_percent"] = w * 100
        dens = [res.density["value"] if res.density else None for res in resolved]
        if all(d is not None for d in dens):
            rho = 1.0 / sum(w / d for w, d in zip(wfr, dens))
            r.density_estimate = {
                "value": rho,
                "source": "Estimated: 1/ρ = Σ w_i/ρ_i from database component densities (ideal mixture, zero porosity)",
                "kind": "estimate",
            }
    try:
        r.composition = Composition.mix([(res.composition, w) for res, w in zip(resolved, wfr)])
    except CompositionError as exc:
        r.status = "error"
        r.errors.append(str(exc))
        return r
    r.name = " + ".join(f"{w * 100:.4g} wt% {res.name or res.input}" for res, w in zip(resolved, wfr))
    r.steps.append("Elemental mass fractions combined: w_i = Σ_k W_k w_i(k)")
    r.provenance.append({"item": "Mixture rule", "source": "Mass-fraction weighted sum of component compositions"})
    for res in resolved:
        for p in res.provenance:
            r.provenance.append({**p, "item": f"{res.name or res.input}: {p['item']}"})
        label = res.name if res.input in db.entries and res.name else res.input
        r.warnings += [f"{label}: {w}" for w in res.warnings]
    r.provenance.append(
        {"item": "Composite density", "source": "Not in database – enter measured density (estimate shown if available)"}
    )
    return r
