import math

import pytest

from science.shielding import ShieldingError, shielding
from science.units import UnitError, energy_to_mev, length_to_cm


@pytest.mark.parametrize("v,u,mev", [(661657, "eV", 0.661657), (661.657, "keV", 0.661657), (1.25, "MeV", 1.25), (2, "GeV", 2000), (5, "kev", 5e-3)])
def test_energy_units(v, u, mev):
    assert energy_to_mev(v, u) == pytest.approx(mev)


@pytest.mark.parametrize("v,u,cm", [(10, "mm", 1.0), (1, "cm", 1.0), (0.02, "m", 2.0)])
def test_length_units(v, u, cm):
    assert length_to_cm(v, u) == pytest.approx(cm)


def test_unknown_unit():
    with pytest.raises(UnitError):
        energy_to_mev(1, "furlong")


def test_shielding_quantities():
    s = shielding(0.1, 10.0, 2.0)  # mu = 1 /cm
    assert s.mu_cm_inv == pytest.approx(1.0)
    assert s.mfp_cm == pytest.approx(1.0)
    assert s.hvl_cm == pytest.approx(math.log(2))
    assert s.tvl_cm == pytest.approx(math.log(10))
    assert s.transmission == pytest.approx(math.exp(-2))
    assert s.shielding_efficiency_percent == pytest.approx((1 - math.exp(-2)) * 100)


def test_hvl_halves_intensity():
    s = shielding(0.0772, 7.2)
    s2 = shielding(0.0772, 7.2, s.hvl_cm)
    assert s2.transmission == pytest.approx(0.5)
    s3 = shielding(0.0772, 7.2, s.tvl_cm)
    assert s3.transmission == pytest.approx(0.1)


@pytest.mark.parametrize("rho", [0, -1, None])
def test_density_required(rho):
    with pytest.raises(ShieldingError):
        shielding(0.1, rho)
