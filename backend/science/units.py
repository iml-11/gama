"""Unit conversions. Internal units: energy in MeV, length in cm."""

from __future__ import annotations

ENERGY_TO_MEV = {"eV": 1e-6, "keV": 1e-3, "MeV": 1.0, "GeV": 1e3}
LENGTH_TO_CM = {"um": 1e-4, "mm": 0.1, "cm": 1.0, "m": 100.0}


class UnitError(ValueError):
    pass


def _lookup(table: dict[str, float], unit: str, kind: str) -> float:
    for key, factor in table.items():
        if key.lower() == unit.strip().lower():
            return factor
    raise UnitError(f"Unknown {kind} unit '{unit}'. Supported: {', '.join(table)}")


def energy_to_mev(value: float, unit: str) -> float:
    return value * _lookup(ENERGY_TO_MEV, unit, "energy")


def mev_to(value_mev: float, unit: str) -> float:
    return value_mev / _lookup(ENERGY_TO_MEV, unit, "energy")


def length_to_cm(value: float, unit: str) -> float:
    return value * _lookup(LENGTH_TO_CM, unit, "length")


def cm_to(value_cm: float, unit: str) -> float:
    return value_cm / _lookup(LENGTH_TO_CM, unit, "length")
