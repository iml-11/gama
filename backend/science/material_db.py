"""Local material database: curated entries, NIST ESTAR compositions, elements
and user-defined custom materials.

Every entry carries provenance for its composition and (if any) its density.
Densities are *never* invented: an entry either has a sourced value or none.
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache

from .composition import Composition, CompositionError
from .elements import NAME_VARIANTS, element, elements_by_z
from .formula_parser import FormulaError, parse_formula
from .paths import CURATED_FILE, ESTAR_FILE, USER_DIR

ESTAR_SOURCE = "NIST ESTAR material composition table (ICRU Report 37)"
CUSTOM_FILE = USER_DIR / "custom_materials.json"


@dataclass
class Density:
    value: float
    source: str
    kind: str = "database"  # "database" | "user"

    def to_dict(self) -> dict:
        return {"value": self.value, "source": self.source, "kind": self.kind}


@dataclass
class MaterialEntry:
    id: str
    name: str
    category: str
    source_kind: str  # curated | preset | nist_estar | element | custom
    aliases: list[str]
    composition: Composition | None
    composition_source: str
    density: Density | None = None
    notes: str = ""
    confidence: str = "high"
    formula: str | None = None
    repeat_unit: bool = False
    family: str | None = None
    reference: str | None = None
    created: str | None = None

    def summary(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "source_kind": self.source_kind,
            "formula": self.formula,
            "repeat_unit": self.repeat_unit,
            "aliases": self.aliases,
            "density": self.density.to_dict() if self.density else None,
            "composition_source": self.composition_source,
            "notes": self.notes,
            "confidence": self.confidence,
            "family": self.family,
            "reference": self.reference,
        }

    def to_dict(self) -> dict:
        d = self.summary()
        d["composition"] = self.composition.to_dict() if self.composition else None
        return d


@dataclass
class Family:
    id: str
    name: str
    aliases: list[str]
    presets: list[str]
    warning: str
    templates: list[str] = field(default_factory=list)

    def to_dict(self, db: "MaterialDB") -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "aliases": self.aliases,
            "warning": self.warning,
            "templates": self.templates,
            "presets": [db.get(p).to_dict() for p in self.presets],
        }


def _pretty_estar_name(raw: str) -> str:
    s = raw.replace("_", " ").replace(" ,", ",")
    words = []
    for w in s.split(" "):
        if re.fullmatch(r"\(?(ICRP|ICRU|NIST)\)?,?", w) or re.match(r"^[A-Z]-?\d", w) or w.startswith("(") and w[1:3].isupper() and len(w) <= 6:
            words.append(w)
        else:
            words.append(w.lower())
    out = " ".join(words)
    # Keep locant prefixes such as "N,N-" or "N-" upper case.
    out = re.sub(r"^([a-z](?:,[a-z])*)-", lambda m: m.group(1).upper() + "-", out)
    return out[0].upper() + out[1:]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


class MaterialDB:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.entries: dict[str, MaterialEntry] = {}
        self.families: dict[str, Family] = {}
        self._estar: dict[int, dict] = {}
        self._load_estar()
        self._load_elements()
        self._load_curated()
        self._load_custom()
        self._reindex()

    # ------------------------------------------------------------------ load
    def _load_estar(self) -> None:
        data = json.loads(ESTAR_FILE.read_text())
        self._estar = {m["estar_id"]: m for m in data["materials"]}

    def _estar_composition(self, estar_id: int) -> Composition:
        m = self._estar[estar_id]
        # NIST fractions sum to 1 within rounding; renormalise explicitly.
        return Composition.from_mass_fractions({int(k): v for k, v in m["mass_fractions"].items()}, normalize=True)

    def _estar_density(self, estar_id: int) -> Density:
        m = self._estar[estar_id]
        return Density(m["density_g_cm3"], f"{ESTAR_SOURCE}: '{_pretty_estar_name(m['name'])}'")

    def _load_elements(self) -> None:
        for z, el in elements_by_z().items():
            aliases = [el.name.lower()]
            aliases += [k for k, v in NAME_VARIANTS.items() if v == el.symbol]
            dens = self._estar_density(z) if z in self._estar and z <= 98 else None
            notes = ""
            if dens and dens.value < 0.01:
                notes = "Gas at NIST reference conditions (20 °C, 1 atm)."
            if z == 6:
                notes = "NIST density is for amorphous carbon; graphite is listed separately."
            if not el.standard_atomic_weight:
                notes = (notes + " No standard atomic weight: mass number of the longest-lived isotope used.").strip()
            self.entries[f"element-{el.symbol.lower()}"] = MaterialEntry(
                id=f"element-{el.symbol.lower()}",
                name=el.name,
                category="element",
                source_kind="element",
                aliases=aliases,
                composition=Composition.from_counts({el.symbol: 1}, formula=el.symbol),
                composition_source="Pure element",
                density=dens,
                notes=notes,
                formula=el.symbol,
            )

    def _curated_entry(self, raw: dict, kind: str) -> MaterialEntry:
        comp_spec = raw["composition"]
        formula = None
        repeat = False
        if "formula" in comp_spec:
            parsed = parse_formula(comp_spec["formula"])
            comp = Composition.from_counts(parsed.counts, formula=parsed.normalized)
            formula = parsed.normalized
            repeat = bool(comp_spec.get("repeat_unit"))
        elif "estar_id" in comp_spec:
            comp = self._estar_composition(comp_spec["estar_id"])
        else:
            comp = Composition.from_mass_fractions(comp_spec["mass_fractions"])
        dens = None
        d = raw.get("density")
        if d:
            if d.get("estar_id"):
                dens = self._estar_density(d["estar_id"])
            elif d.get("value") is not None:
                dens = Density(float(d["value"]), d["source"])
        return MaterialEntry(
            id=raw["id"],
            name=raw["name"],
            category=raw["category"],
            source_kind=kind,
            aliases=raw.get("aliases", []),
            composition=comp,
            composition_source=raw.get("composition_source", ""),
            density=dens,
            notes=raw.get("notes", ""),
            confidence=raw.get("confidence", "high"),
            formula=formula,
            repeat_unit=repeat,
            family=raw.get("family"),
        )

    def _load_curated(self) -> None:
        data = json.loads(CURATED_FILE.read_text())
        used_estar: set[int] = set()
        for raw in data["materials"]:
            e = self._curated_entry(raw, "curated")
            self.entries[e.id] = e
            if raw.get("estar_id"):
                used_estar.add(raw["estar_id"])
        for raw in data["presets"]:
            e = self._curated_entry(raw, "preset")
            self.entries[e.id] = e
            if raw.get("estar_id"):
                used_estar.add(raw["estar_id"])
        for raw in data["families"]:
            self.families[raw["id"]] = Family(
                id=raw["id"],
                name=raw["name"],
                aliases=raw["aliases"],
                presets=raw["presets"],
                warning=raw["warning"],
                templates=raw.get("templates", []),
            )
        # Remaining NIST ESTAR compounds/mixtures (elements are handled above).
        for eid, m in self._estar.items():
            if eid <= 98 or eid in used_estar:
                continue
            name = _pretty_estar_name(m["name"])
            aliases = [name.lower()]
            base = re.sub(r"\s*\(.*?\)", "", name).strip().lower()
            if base and base != name.lower():
                aliases.append(base)
            for inner in re.findall(r"\(([^)]*)\)", name):
                for part in inner.split(","):
                    p = part.strip().lower()
                    if len(p) > 3 and not p.startswith(("icr", "nist")):
                        aliases.append(p)
            gas = m["density_g_cm3"] < 0.01
            self.entries[f"estar-{eid}"] = MaterialEntry(
                id=f"estar-{eid}",
                name=name,
                category="gas" if gas else "nist",
                source_kind="nist_estar",
                aliases=aliases,
                composition=self._estar_composition(eid),
                composition_source=ESTAR_SOURCE,
                density=self._estar_density(eid),
                notes="Gas at NIST reference conditions (20 °C, 1 atm)." if gas else "",
                confidence="high",
            )

    # ------------------------------------------------------------ custom
    def _load_custom(self) -> None:
        if not CUSTOM_FILE.exists():
            return
        for raw in json.loads(CUSTOM_FILE.read_text()).get("materials", []):
            try:
                self.entries[raw["id"]] = self._custom_entry(raw)
            except (FormulaError, CompositionError, KeyError):
                continue

    def _custom_entry(self, raw: dict) -> MaterialEntry:
        formula = None
        repeat = False
        if raw.get("formula"):
            parsed = parse_formula(raw["formula"])
            comp = Composition.from_counts(parsed.counts, formula=parsed.normalized)
            formula = parsed.normalized
            repeat = parsed.is_repeat_unit
            src = "User-defined formula"
        else:
            fr = {k: v / 100.0 for k, v in raw["mass_percent"].items()}
            comp = Composition.from_mass_fractions(fr, tolerance=raw.get("tolerance", 0.005))
            src = "User-defined elemental mass fractions"
        dens = None
        if raw.get("density") is not None:
            dens = Density(float(raw["density"]), "User supplied (custom material)", kind="user")
        return MaterialEntry(
            id=raw["id"],
            name=raw["name"],
            category="custom",
            source_kind="custom",
            aliases=[raw["name"].lower()] + [a.lower() for a in raw.get("aliases", [])],
            composition=comp,
            composition_source=src,
            density=dens,
            notes=raw.get("notes", ""),
            confidence="user",
            formula=formula,
            repeat_unit=repeat,
            reference=raw.get("reference"),
            created=raw.get("created"),
        )

    def _save_custom(self) -> None:
        USER_DIR.mkdir(parents=True, exist_ok=True)
        items = [e for e in self.entries.values() if e.source_kind == "custom"]
        out = []
        for e in items:
            rec = {
                "id": e.id,
                "name": e.name,
                "notes": e.notes,
                "reference": e.reference,
                "density": e.density.value if e.density else None,
                "created": e.created,
            }
            if e.formula:
                rec["formula"] = e.formula
            else:
                rec["mass_percent"] = {s: w * 100 for s, w in e.composition.mass_fractions.items()}
            out.append(rec)
        CUSTOM_FILE.write_text(json.dumps({"materials": out}, indent=1))

    def add_custom(self, raw: dict) -> MaterialEntry:
        name = (raw.get("name") or "").strip()
        if not name:
            raise ValueError("A name is required.")
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "material"
        rid = f"custom-{slug}"
        with self._lock:
            for e in self.entries.values():
                if e.source_kind != "custom" and _norm(name) in {_norm(a) for a in e.aliases + [e.name]}:
                    raise ValueError(f"'{name}' is already the name of a database material ({e.name}). Choose another name.")
            rec = {**raw, "id": rid, "name": name, "created": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            entry = self._custom_entry(rec)
            self.entries[rid] = entry
            self._save_custom()
            self._reindex()
        return entry

    def delete_custom(self, rid: str) -> None:
        with self._lock:
            e = self.entries.get(rid)
            if not e or e.source_kind != "custom":
                raise KeyError(rid)
            del self.entries[rid]
            self._save_custom()
            self._reindex()

    # ------------------------------------------------------------ lookup
    def _reindex(self) -> None:
        idx: dict[str, list[str]] = {}
        for e in self.entries.values():
            for key in {_norm(e.name), *(_norm(a) for a in e.aliases)}:
                idx.setdefault(key, []).append(e.id)
        self._alias_index = idx
        fam: dict[str, str] = {}
        for f in self.families.values():
            for a in f.aliases + [f.name]:
                fam[_norm(a)] = f.id
        self._family_index = fam

    def get(self, rid: str) -> MaterialEntry:
        return self.entries[rid]

    def lookup_exact(self, text: str) -> tuple[str, object] | None:
        """Exact (case-insensitive) name/alias match. Custom > family > curated > others."""
        key = _norm(text)
        ids = self._alias_index.get(key, [])
        order = {"custom": 0, "curated": 2, "preset": 3, "element": 4, "nist_estar": 5}
        custom = [i for i in ids if self.entries[i].source_kind == "custom"]
        if custom:
            return "material", self.entries[custom[0]]
        if key in self._family_index:
            return "family", self.families[self._family_index[key]]
        if ids:
            best = sorted(ids, key=lambda i: order.get(self.entries[i].source_kind, 9))[0]
            return "material", self.entries[best]
        return None

    def element_entry(self, symbol: str) -> MaterialEntry:
        return self.entries[f"element-{symbol.lower()}"]

    def known_formulas(self) -> dict[str, str]:
        """Formulas of named non-polymer compounds, for 'incomplete formula' hints."""
        return {
            e.formula: e.name
            for e in self.entries.values()
            if e.formula and not e.repeat_unit and e.category not in ("element",)
        }

    def same_composition(self, comp: Composition, tol: float = 2e-4) -> list[MaterialEntry]:
        """Non-gaseous, non-polymer entries whose composition equals ``comp``."""
        out = []
        for e in self.entries.values():
            if e.composition is None or e.repeat_unit or e.category in ("gas", "polymer", "custom"):
                continue
            a, b = e.composition.mass_fractions, comp.mass_fractions
            if a.keys() == b.keys() and all(abs(a[k] - b[k]) <= tol for k in a):
                out.append(e)
        return out

    def search(self, q: str, limit: int = 12) -> list[dict]:
        qn = _norm(q)
        if not qn:
            return []
        scored: list[tuple[float, dict]] = []
        kind_bonus = {"custom": 7, "element": 6, "curated": 5, "preset": 3, "nist_estar": 0}
        raw = q.strip()
        for f in self.families.values():
            s = _score(qn, [f.name], f.aliases)
            if s:
                scored.append((s + 5, {"type": "family", "id": f.id, "name": f.name, "category": "ambiguous",
                                       "detail": "Several compositions – choose a preset", "match": _best_alias(qn, [f.name] + f.aliases)}))
        for e in self.entries.values():
            names = [e.name] + e.aliases
            s = _score(qn, [e.name], e.aliases)
            if e.formula and raw and e.formula.startswith(raw) and raw[0].isupper():
                # Formulas match case-sensitively (Pm = promethium, PM != Pm).
                s = max(s, 90 if e.formula == raw else 70)
            if not s:
                continue
            if e.category == "gas":
                s -= 3
            scored.append(
                (
                    s + kind_bonus.get(e.source_kind, 0) - len(e.name) / 100.0,
                    {
                        "type": "material",
                        "id": e.id,
                        "name": e.name,
                        "category": e.category,
                        "formula": e.formula,
                        "repeat_unit": e.repeat_unit,
                        "source_kind": e.source_kind,
                        "density": e.density.value if e.density else None,
                        "match": _best_alias(qn, names),
                    },
                )
            )
        scored.sort(key=lambda t: -t[0])
        seen, out = set(), []
        for _, item in scored:
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            out.append(item)
            if len(out) >= limit:
                break
        return out


def _score(q: str, primary: list[str], aliases: list[str]) -> float:
    """Match score; the canonical name ranks above aliases."""
    best = 0.0
    for bonus, names in ((10, primary), (0, aliases)):
        for n in names:
            nn = _norm(n)
            if nn == q:
                s = 100
            elif nn.startswith(q):
                s = 80
            elif any(w.startswith(q) for w in re.split(r"[\s(),/-]+", nn)):
                s = 60
            elif len(q) >= 3 and q in nn:
                s = 40
            else:
                continue
            best = max(best, s + bonus)
    return best


def _best_alias(q: str, names: list[str]) -> str:
    for n in names:
        if _norm(n).startswith(q):
            return n
    return names[0]


@lru_cache(maxsize=1)
def get_db() -> MaterialDB:
    return MaterialDB()
