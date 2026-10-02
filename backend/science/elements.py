"""Element table: symbols, names and IUPAC 2021 standard atomic weights.

Atomic weights are used to convert atom counts (chemical formulas) into mass
fractions. They are loaded from ``data/elements/atomic_weights.json``, which is
built by ``scripts/build_reference_data.py`` (see that file for provenance).

Note: the XCOM engine converts barn/atom to cm^2/g with XCOM's *own* atomic
weight table (stored in each ``data/xcom/Znnn.json``) so that elemental results
reproduce XCOM exactly. The two tables differ only in the last digits.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

from .paths import ELEMENTS_FILE


@dataclass(frozen=True)
class Element:
    Z: int
    symbol: str
    name: str
    atomic_weight: float
    uncertainty: float
    standard_atomic_weight: bool


@lru_cache(maxsize=1)
def _table() -> dict:
    return json.loads(ELEMENTS_FILE.read_text())


@lru_cache(maxsize=1)
def elements_by_symbol() -> dict[str, Element]:
    return {e["symbol"]: Element(**e) for e in _table()["elements"]}


@lru_cache(maxsize=1)
def elements_by_z() -> dict[int, Element]:
    return {e.Z: e for e in elements_by_symbol().values()}


def element(symbol_or_z: str | int) -> Element:
    if isinstance(symbol_or_z, int):
        return elements_by_z()[symbol_or_z]
    return elements_by_symbol()[symbol_or_z]


def atomic_weight_source() -> dict:
    t = _table()
    return {"source": t["source"], "reference": t["reference"], "distribution": t["distribution"]}


# Aliases for element names that have common spelling variants.
NAME_VARIANTS = {"aluminium": "Al", "caesium": "Cs", "sulphur": "S", "wolfram": "W"}
