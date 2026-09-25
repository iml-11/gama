"""Gamma-ray emission lines of common check/calibration sources.

Loaded from ``data/isotopes/gamma_lines.json`` (UKAEA DECAY2012 library; see
``scripts/build_reference_data.py``). No energies are hard-coded here.
"""

from __future__ import annotations

import json
from functools import lru_cache

from .paths import ISOTOPES_FILE


@lru_cache(maxsize=1)
def _data() -> dict:
    return json.loads(ISOTOPES_FILE.read_text())


def dataset_info() -> dict:
    d = _data()
    return {"source": d["source"], "reference": d["reference"], "notes": d["notes"]}


def list_isotopes() -> list[dict]:
    return _data()["isotopes"]


def get_isotope(iso_id: str) -> dict:
    key = iso_id.replace(" ", "").lower()
    for iso in _data()["isotopes"]:
        if iso["id"].replace("-", "").lower() == key.replace("-", ""):
            return iso
    raise KeyError(iso_id)
