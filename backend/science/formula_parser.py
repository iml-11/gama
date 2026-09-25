"""Chemical formula parser.

Supported syntax
----------------
* Element symbols with integer or decimal counts: ``H2O``, ``Bi2WO6``,
  ``Fe0.7Ni0.3``. Symbols are case sensitive (``Co`` is cobalt, ``CO`` is
  carbon monoxide).
* Nested groups with ``()``, ``[]`` or ``{}`` and a multiplier:
  ``Ca3(PO4)2``, ``K4[Fe(CN)6]``.
* Hydrates / adducts separated by ``·``, ``•``, ``*`` or ``.``:
  ``CuSO4·5H2O``, ``CaSO4.2H2O``.
* Polymer repeat units: ``(C5H8O2)n``, ``-(CH2-CH2)-n``, ``[C2H4]n``. The
  trailing ``n`` is dropped because elemental mass fractions of an ideal
  repeat unit do not depend on the degree of polymerisation.
* Optional ionic charge suffix (``SO4^2-``, ``NH4+``) when ``allow_charge`` is
  set; the charge is ignored for the composition (electron mass is negligible
  for photon attenuation) and a warning is emitted.

The parser never guesses: anything it cannot read unambiguously raises
:class:`FormulaError`. Heuristic plausibility checks (charge balance, prefix of
a known formula) only produce *warnings*; the formula is always parsed exactly
as typed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .elements import elements_by_symbol

MAX_Z = 100  # NIST XCOM covers Z = 1..100

OPEN = "([{"
CLOSE = ")]}"
PAIRS = {")": "(", "]": "[", "}": "{"}
HYDRATE_SEPARATORS = "·•∙*"


class FormulaError(ValueError):
    def __init__(self, message: str, position: int | None = None):
        super().__init__(message)
        self.position = position


@dataclass
class ParsedFormula:
    input: str
    counts: dict[str, float]
    is_repeat_unit: bool = False
    charge: int = 0
    warnings: list[str] = field(default_factory=list)
    body: str = ""

    @property
    def display(self) -> str:
        """Formula as typed (brackets/hydrate kept), without polymer 'n' and spaces."""
        return self.body or self.normalized

    @property
    def normalized(self) -> str:
        """Formula in input element order with integer-looking counts."""
        return format_counts(self.counts)


def format_counts(counts: dict[str, float]) -> str:
    out = []
    for sym, n in counts.items():
        if abs(n - 1) < 1e-12:
            out.append(sym)
        elif abs(n - round(n)) < 1e-9:
            out.append(f"{sym}{int(round(n))}")
        else:
            out.append(f"{sym}{n:g}")
    return "".join(out)


_NUMBER = re.compile(r"\d+(?:\.\d+)?")
_ALLOWED = re.compile(r"^[A-Za-z0-9()\[\]{}·•∙*.\-+^\s]+$")


def looks_like_formula(text: str) -> bool:
    """Cheap test used by the resolver before attempting a full parse."""
    t = text.strip()
    if not t or not _ALLOWED.match(t):
        return False
    if " " in t.strip():
        return False
    return bool(re.search(r"[A-Z]", t))


def _strip_polymer_notation(text: str) -> tuple[str, bool]:
    """Remove repeat-unit notation. Returns (formula, is_repeat_unit)."""
    t = text.strip()
    # -(CH2-CH2)-n  /  -[CH2]-n  /  (C5H8O2)n  /  [C2H4]n  / {..}n
    m = re.fullmatch(r"-?\s*([(\[{])(.+)([)\]}])\s*-?\s*n", t)
    if m and PAIRS.get(m.group(3)) == m.group(1) and _balanced(m.group(2)):
        inner = m.group(2).replace("-", "")
        return inner, True
    return t, False


def _balanced(s: str) -> bool:
    stack = []
    for ch in s:
        if ch in OPEN:
            stack.append(ch)
        elif ch in CLOSE:
            if not stack or stack.pop() != PAIRS[ch]:
                return False
    return not stack


def _strip_charge(text: str) -> tuple[str, int]:
    m = re.search(r"\^?(\d*)([+-])$", text)
    if not m:
        return text, 0
    mag = int(m.group(1)) if m.group(1) else 1
    # "NH4+" : the digit before + belongs to H4 unless a caret is present.
    if m.group(1) and not m.group(0).startswith("^"):
        mag = 1
        return text[: -1], (1 if m.group(2) == "+" else -1) * mag
    return text[: m.start()], (1 if m.group(2) == "+" else -1) * mag


def _split_hydrate(text: str) -> tuple[list[str], list[str]]:
    """Split ``CuSO4·5H2O`` into parts. Returns (parts, warnings)."""
    warnings: list[str] = []
    for sep in HYDRATE_SEPARATORS:
        text = text.replace(sep, "·")
    # A '.' is a hydrate separator only when it is followed by an optional
    # integer and then an element/group, and not part of a decimal count.
    out = []
    i = 0
    buf = ""
    while i < len(text):
        ch = text[i]
        if ch == ".":
            prev_digit = i > 0 and text[i - 1].isdigit()
            m = re.match(r"\.(\d*)([A-Z(\[{])", text[i:])
            if m and (not prev_digit or m.group(1) == ""):
                out.append(buf)
                buf = ""
                i += 1
                continue
            if m and prev_digit:
                # "4.2H2O" is ambiguous (decimal count 4.2 or hydrate). Only a
                # following water/ammonia/deuterium-oxide molecule makes it a
                # hydrate; otherwise it is a decimal count (Fe0.7Ni0.3).
                if re.match(r"\.\d*(H2O|D2O|NH3)", text[i:]):
                    warnings.append(
                        f"Interpreted '.' in '{text}' as a hydrate separator (not a decimal count). "
                        "Use '·' or '*' to avoid ambiguity."
                    )
                    out.append(buf)
                    buf = ""
                    i += 1
                    continue
        if ch == "·":
            out.append(buf)
            buf = ""
            i += 1
            continue
        buf += ch
        i += 1
    out.append(buf)
    if any(not p for p in out):
        raise FormulaError("Empty part next to a hydrate separator.")
    return out, warnings


def _parse_segment(text: str, offset: int) -> dict[str, float]:
    """Recursive-descent parser for one formula segment (no hydrate dots)."""
    known = elements_by_symbol()
    pos = 0

    def number() -> float | None:
        nonlocal pos
        m = _NUMBER.match(text, pos)
        if not m:
            return None
        pos = m.end()
        return float(m.group(0))

    def group(closing: str | None) -> dict[str, float]:
        nonlocal pos
        counts: dict[str, float] = {}
        while pos < len(text):
            ch = text[pos]
            if ch in OPEN:
                start = pos
                pos += 1
                inner = group(ch)
                if pos >= len(text) or PAIRS.get(text[pos]) != ch:
                    raise FormulaError(f"Unclosed '{ch}'.", offset + start)
                pos += 1
                mult = number()
                if mult is not None and mult == 0:
                    raise FormulaError("Zero multiplier.", offset + pos)
                for k, v in inner.items():
                    counts[k] = counts.get(k, 0.0) + v * (mult if mult is not None else 1.0)
            elif ch in CLOSE:
                if closing is None:
                    raise FormulaError(f"Unexpected '{ch}'.", offset + pos)
                return counts
            elif ch.isupper():
                sym = ch
                if pos + 1 < len(text) and text[pos + 1].islower():
                    two = text[pos : pos + 2]
                    if two in known:
                        sym = two
                    elif ch not in known:
                        raise FormulaError(f"Unknown element symbol '{two}'.", offset + pos)
                if sym not in known:
                    raise FormulaError(f"Unknown element symbol '{sym}'.", offset + pos)
                if known[sym].Z > MAX_Z:
                    raise FormulaError(f"Element {sym} (Z>{MAX_Z}) is outside the XCOM data range.", offset + pos)
                pos += len(sym)
                n = number()
                if n is not None and n == 0:
                    raise FormulaError(f"Zero count for {sym}.", offset + pos)
                counts[sym] = counts.get(sym, 0.0) + (n if n is not None else 1.0)
            elif ch.islower():
                raise FormulaError(
                    f"Unexpected lowercase '{ch}'. Element symbols start with a capital letter "
                    "(e.g. 'Co' = cobalt, 'CO' = carbon + oxygen).",
                    offset + pos,
                )
            elif ch.isdigit():
                raise FormulaError("A count must follow an element or a closing bracket.", offset + pos)
            else:
                raise FormulaError(f"Unexpected character '{ch}'.", offset + pos)
        if closing is not None:
            raise FormulaError(f"Unclosed '{closing}'.", offset)
        return counts

    result = group(None)
    if not result:
        raise FormulaError("No elements found.", offset)
    return result


def parse_formula(text: str, allow_charge: bool = False) -> ParsedFormula:
    """Parse a chemical formula into element counts (see module docstring)."""
    if text is None or not text.strip():
        raise FormulaError("Empty formula.")
    raw = text.strip()
    warnings: list[str] = []
    body, is_repeat = _strip_polymer_notation(raw)
    body = body.replace(" ", "")
    if not is_repeat and "-" in body.strip("-+") and not allow_charge:
        raise FormulaError("Unexpected '-'. For polymers use repeat-unit notation such as (C2H4)n.")
    charge = 0
    if allow_charge:
        body, charge = _strip_charge(body)
        if charge:
            warnings.append(f"Ionic charge {charge:+d} ignored for elemental composition.")
    elif re.search(r"[+^]|-$", body):
        raise FormulaError("Ionic charges are not accepted in a material formula.")
    parts, w = _split_hydrate(body)
    warnings += w
    counts: dict[str, float] = {}
    offset = 0
    for part in parts:
        m = re.match(r"(\d+(?:\.\d+)?)?(.*)", part)
        coef = float(m.group(1)) if m.group(1) else 1.0
        seg = m.group(2)
        if not seg:
            raise FormulaError("Coefficient without formula.", offset)
        for k, v in _parse_segment(seg, offset + (len(m.group(1)) if m.group(1) else 0)).items():
            counts[k] = counts.get(k, 0.0) + coef * v
        offset += len(part) + 1
    display = body.replace("*", "·").replace("•", "·").replace("∙", "·")
    if not re.search(r"[()\[\]{}·.]", display):
        display = ""
    return ParsedFormula(input=raw, counts=counts, is_repeat_unit=is_repeat, charge=charge, warnings=warnings, body=display)


# --------------------------------------------------------------------------
# Plausibility heuristics (warnings only)
# --------------------------------------------------------------------------

# Common oxidation states, used ONLY to flag formulas that cannot be charge
# balanced (e.g. a truncated "Bi2WO"). Never used in any calculation.
_OXIDATION_STATES: dict[str, tuple[int, ...]] = {
    "H": (1, -1), "Li": (1,), "Na": (1,), "K": (1,), "Rb": (1,), "Cs": (1,),
    "Be": (2,), "Mg": (2,), "Ca": (2,), "Sr": (2,), "Ba": (2,),
    "B": (3,), "Al": (3,), "Ga": (3,), "In": (3, 1), "Tl": (1, 3),
    "Si": (4,), "Ge": (4, 2), "Sn": (2, 4), "Pb": (2, 4),
    "N": (-3, 3, 5), "P": (-3, 3, 5), "As": (3, 5, -3), "Sb": (3, 5), "Bi": (3, 5),
    "O": (-2, -1), "S": (-2, 4, 6), "Se": (-2, 4, 6), "Te": (-2, 4, 6),
    "F": (-1,), "Cl": (-1, 1, 3, 5, 7), "Br": (-1, 1, 3, 5), "I": (-1, 1, 3, 5, 7),
    "Sc": (3,), "Ti": (2, 3, 4), "V": (2, 3, 4, 5), "Cr": (2, 3, 6), "Mn": (2, 3, 4, 7),
    "Fe": (2, 3), "Co": (2, 3), "Ni": (2, 3), "Cu": (1, 2), "Zn": (2,),
    "Y": (3,), "Zr": (4,), "Nb": (3, 5), "Mo": (3, 4, 6), "Ag": (1,), "Cd": (2,),
    "La": (3,), "Ce": (3, 4), "Pr": (3, 4), "Nd": (3,), "Sm": (2, 3), "Eu": (2, 3), "Gd": (3,),
    "Tb": (3, 4), "Dy": (3,), "Ho": (3,), "Er": (3,), "Tm": (3,), "Yb": (2, 3), "Lu": (3,),
    "Hf": (4,), "Ta": (5,), "W": (4, 5, 6), "Re": (4, 6, 7), "Hg": (1, 2), "Th": (4,), "U": (3, 4, 5, 6),
}
_ANIONS = {"O", "S", "Se", "Te", "F", "Cl", "Br", "I", "N", "P"}


def charge_balance_possible(counts: dict[str, float]) -> bool | None:
    """True/False for simple inorganic formulas, None when not applicable.

    Not applicable (None) for: carbon-containing formulas, formulas with
    non-integer counts, elements outside the table, or formulas without an
    anion-forming element (alloys, intermetallics).
    """
    if "C" in counts or not (_ANIONS & counts.keys()):
        return None
    if any(abs(n - round(n)) > 1e-9 for n in counts.values()):
        return None
    if any(s not in _OXIDATION_STATES for s in counts):
        return None
    if len(counts) == 1:
        return None
    # Set of achievable total charges (each atom picks any allowed state).
    totals = {0}
    for sym, n in counts.items():
        states = _OXIDATION_STATES[sym]
        for _ in range(int(round(n))):
            totals = {t + s for t in totals for s in states}
            if len(totals) > 5000:
                return None
    return 0 in totals


def plausibility_warnings(parsed: ParsedFormula, known_formulas: dict[str, str] | None = None) -> list[str]:
    warnings: list[str] = []
    if known_formulas:
        norm = parsed.normalized
        for formula, name in known_formulas.items():
            if formula != norm and formula.startswith(norm) and re.match(r"\d", formula[len(norm):] or "x"):
                warnings.append(
                    f"'{parsed.input}' looks incomplete: it is a prefix of {formula} ({name}). "
                    f"It has been parsed literally as {norm}."
                )
                break
    if charge_balance_possible(parsed.counts) is False:
        warnings.append(
            f"{parsed.normalized} cannot be charge-balanced with common oxidation states. "
            "Please check the formula for a missing or wrong subscript."
        )
    return warnings
