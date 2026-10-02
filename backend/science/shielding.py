"""Density-dependent shielding quantities (narrow-beam, no build-up).

    mu   = rho * (mu/rho)            linear attenuation coefficient [1/cm]
    MFP  = 1 / mu                    mean free path [cm]
    HVL  = ln(2) / mu                half-value layer [cm]
    TVL  = ln(10) / mu               tenth-value layer [cm]
    T    = I/I0 = exp(-mu * x)       transmission (Beer-Lambert)
    SE   = (1 - exp(-mu * x)) * 100  shielding efficiency [%]

These are narrow-beam (good-geometry) quantities. Broad-beam transmission
through thick shields is larger because of scattered photons (build-up),
which is not modelled here.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, asdict


class ShieldingError(ValueError):
    pass


@dataclass
class ShieldingResult:
    density_g_cm3: float
    mu_cm_inv: float
    mfp_cm: float
    hvl_cm: float
    tvl_cm: float
    thickness_cm: float | None
    transmission: float | None
    shielding_efficiency_percent: float | None

    def to_dict(self) -> dict:
        return asdict(self)


def linear_attenuation(mass_attenuation_cm2_g: float, density_g_cm3: float) -> float:
    if density_g_cm3 is None or not density_g_cm3 > 0:
        raise ShieldingError("Density must be a positive number (g/cm3).")
    if not mass_attenuation_cm2_g > 0:
        raise ShieldingError("Mass attenuation coefficient must be positive.")
    return density_g_cm3 * mass_attenuation_cm2_g


def transmission(mu_cm_inv: float, thickness_cm: float) -> float:
    if thickness_cm < 0:
        raise ShieldingError("Thickness must be non-negative.")
    return math.exp(-mu_cm_inv * thickness_cm)


def shielding(mass_attenuation_cm2_g: float, density_g_cm3: float, thickness_cm: float | None = None) -> ShieldingResult:
    mu = linear_attenuation(mass_attenuation_cm2_g, density_g_cm3)
    t = transmission(mu, thickness_cm) if thickness_cm is not None else None
    return ShieldingResult(
        density_g_cm3=density_g_cm3,
        mu_cm_inv=mu,
        mfp_cm=1.0 / mu,
        hvl_cm=math.log(2) / mu,
        tvl_cm=math.log(10) / mu,
        thickness_cm=thickness_cm,
        transmission=t,
        shielding_efficiency_percent=(1.0 - t) * 100.0 if t is not None else None,
    )
