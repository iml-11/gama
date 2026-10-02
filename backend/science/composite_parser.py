"""Syntax-level parser for composite / mixture descriptions.

This module only splits text into components and fractions; resolving each
component to a composition is done by :mod:`science.material_resolver`.

Accepted forms (fractions are weight % unless stated otherwise):

    60 wt% Bi2WO6 + 40 wt% epoxy
    50% WO3 + 50% epoxy                (bare % is read as wt%, with a warning)
    30 wt% Bi2O3 / epoxy               (missing fraction = remainder)
    Bi2WO6 (60 wt%) + epoxy
    Bi2WO6/epoxy 60/40 wt%
    Bi2WO6 epoxy composite with 60% filler
    epoxy composite with 60 wt% Bi2WO6
    60 wt% Bi2WO6 in epoxy
    20 vol% W + 80 vol% PMMA           (needs a density for every component)

Atomic or molar percentages are rejected: they cannot be combined with mass
fractions without additional information and are never converted silently.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

NUM = r"(\d+(?:\.\d+)?)"
UNIT = (
    r"(?:(?:wt|mass|weight|vol|volume|at|atom|mol|mole)\.?\s*%"
    r"|%\s*(?:wt|w/w|vol|v/v|at|mol|by\s+weight|by\s+mass|by\s+volume)?\.?"
    r"|(?:wt|vol)\.?(?=\s))"
)
_TERM_LEAD = re.compile(rf"^\s*{NUM}\s*(?P<u>{UNIT})\s*(?:of\s+)?(?P<name>.+?)\s*$", re.I)
_TERM_TRAIL = re.compile(rf"^\s*(?P<name>.+?)\s*[\(\[:,]?\s*{NUM}\s*(?P<u>{UNIT})\s*[\)\]]?\s*$", re.I)
_RATIO = re.compile(
    rf"^\s*(?P<a>[^/:]+?)\s*[/:]\s*(?P<b>[^/:]+?)\s*[\(\[]?\s*{NUM}\s*[/:]\s*{NUM}\s*(?P<u>{UNIT})?\s*[\)\]]?\s*$", re.I
)
_FILLER_SUFFIX = re.compile(
    rf"^\s*(?P<pre>.+?)\s+composites?\b\s*,?\s*(?:with|containing|at|of)?\s*{NUM}\s*(?P<u>{UNIT})\s*"
    rf"(?:filler(?:\s+loading)?|loading|filler\s+content)\s*$",
    re.I,
)
_MATRIX_WITH = re.compile(
    rf"^\s*(?P<m>.+?)\s+(?:composites?\s+)?(?:with|containing|filled\s+with|loaded\s+with)\s+(?P<n>\d+(?:\.\d+)?)\s*(?P<u>{UNIT})\s*(?:of\s+)?(?P<f>.+?)\s*$",
    re.I,
)
_IN_MATRIX = re.compile(rf"^\s*(?P<n>\d+(?:\.\d+)?)\s*(?P<u>{UNIT})\s*(?P<f>.+?)\s+(?:in|dispersed\s+in)\s+(?:an?\s+)?(?P<m>.+?)(?:\s+matrix)?\s*$", re.I)


class CompositeError(ValueError):
    pass


@dataclass
class ComponentSpec:
    text: str
    percent: float | None
    basis: str = "wt"  # wt | vol
    role: str | None = None  # filler | matrix


@dataclass
class CompositeSpec:
    components: list[ComponentSpec]
    style: str = "explicit"  # explicit | filler_unknown
    filler_percent: float | None = None
    filler_basis: str = "wt"
    ambiguous_pair: str | None = None  # "Bi2WO6 epoxy" (split decided by resolver)
    warnings: list[str] = field(default_factory=list)


def _basis(unit: str | None, warnings: list[str], context: str) -> str:
    u = (unit or "").lower().replace(" ", "")
    if not u:
        return "wt"
    if u.startswith(("at", "mol")) or u.endswith(("at", "mol")):
        raise CompositeError(
            f"Atomic/molar percentages ('{context}') are not supported for components. "
            "Give component fractions in wt% (mass) or vol% (with densities)."
        )
    if "vol" in u or "v/v" in u or "volume" in u:
        return "vol"
    if u in ("%",):
        msg = "Interpreted '%' as weight percent (wt%)."
        if msg not in warnings:
            warnings.append(msg)
    return "wt"


def looks_composite(text: str) -> bool:
    t = text.lower()
    return bool(
        "+" in t
        or "%" in t
        or re.search(r"\bcomposites?\b", t)
        or re.search(r"\b(wt|vol)\b", t)
        or (re.search(r"[/:]", t) and not re.fullmatch(r"[\w\s()\-.,]*", t))
    )


def _term(text: str, warnings: list[str]) -> ComponentSpec:
    t = text.strip()
    if not t:
        raise CompositeError("Empty component in composite description.")
    m = _TERM_LEAD.match(t) or _TERM_TRAIL.match(t)
    if m:
        pct = float(m.group(1) if m.re is _TERM_LEAD else m.group(2))
        return ComponentSpec(text=m.group("name").strip(), percent=pct, basis=_basis(m.group("u"), warnings, t))
    if re.search(r"\d\s*%|%", t):
        raise CompositeError(f"Could not read the fraction in '{t}'. Use e.g. '60 wt% Bi2WO6'.")
    return ComponentSpec(text=t, percent=None)


def parse_composite(text: str) -> CompositeSpec:
    t = text.strip()
    warnings: list[str] = []

    m = _FILLER_SUFFIX.match(t)
    if m:
        pre = re.sub(r"\s*[/\-–]\s*", " / ", m.group("pre").strip())
        basis = _basis(m.group("u"), warnings, t)
        return CompositeSpec(
            components=[],
            style="filler_unknown",
            filler_percent=float(m.group(2)),
            filler_basis=basis,
            ambiguous_pair=pre,
            warnings=warnings,
        )
    for rx, filler_group, matrix_group in ((_IN_MATRIX, "f", "m"), (_MATRIX_WITH, "f", "m")):
        m = rx.match(t)
        if m and "+" not in t:
            basis = _basis(m.group("u"), warnings, t)
            pct = float(m.group("n"))
            return CompositeSpec(
                components=[
                    ComponentSpec(text=m.group(filler_group).strip(), percent=pct, basis=basis, role="filler"),
                    ComponentSpec(text=re.sub(r"\s+composites?$", "", m.group(matrix_group).strip(), flags=re.I), percent=None, basis=basis, role="matrix"),
                ],
                warnings=warnings,
            )
    m = _RATIO.match(t)
    if m:
        basis = _basis(m.group("u"), warnings, t)
        return CompositeSpec(
            components=[
                ComponentSpec(m.group("a").strip(), float(m.group(3)), basis),
                ComponentSpec(m.group("b").strip(), float(m.group(4)), basis),
            ],
            warnings=warnings,
        )
    if "+" in t:
        parts = t.split("+")
    elif re.search(r"\s/\s|%\s*[^/]*/", t) or "/" in t:
        parts = t.split("/")
    else:
        parts = [t]
    comps = [_term(p, warnings) for p in parts]
    if len(comps) < 2:
        c = comps[0]
        if c.percent is not None and c.percent < 100:
            raise CompositeError(
                f"Only one component given ({c.percent:g}% {c.text}). Add the other component(s), "
                f"e.g. '{c.percent:g} wt% {c.text} + {100 - c.percent:g} wt% epoxy'."
            )
        raise CompositeError("A composite needs at least two components.")
    bases = {c.basis for c in comps if c.percent is not None}
    if len(bases) > 1:
        raise CompositeError("Do not mix wt% and vol% in one composite description.")
    basis = bases.pop() if bases else "wt"
    for c in comps:
        c.basis = basis
    return CompositeSpec(components=comps, warnings=warnings)


def complete_fractions(comps: list[ComponentSpec]) -> list[float]:
    """Validate and complete percentages (one component may be the remainder)."""
    missing = [c for c in comps if c.percent is None]
    given = sum(c.percent for c in comps if c.percent is not None)
    for c in comps:
        if c.percent is not None and c.percent <= 0:
            raise CompositeError(f"Fraction of '{c.text}' must be positive.")
    if len(missing) > 1:
        raise CompositeError(
            "More than one component has no fraction: "
            + ", ".join(f"'{c.text}'" for c in missing)
            + ". Give fractions for all but at most one component."
        )
    if missing:
        rest = 100.0 - given
        if rest <= 1e-9:
            raise CompositeError(f"Component fractions total {given:g}%, leaving nothing for '{missing[0].text}'.")
        missing[0].percent = rest
    else:
        if abs(given - 100.0) > 0.01:
            raise CompositeError(f"Component fractions total {given:g}%. Please correct the composition.")
    return [c.percent / 100.0 for c in comps]
