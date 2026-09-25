"""Build the non-XCOM reference data files from their published sources.

Everything written here is extracted programmatically from a referenced
dataset; no value is typed in by hand.

1. data/elements/atomic_weights.json
   IUPAC/CIAAW 2021 abridged standard atomic weights (Prohaska et al. 2022,
   Pure Appl. Chem. 94, 573, doi:10.1515/pac-2019-0603), as distributed in the
   public-domain ``periodictable`` package (v2.1.0, P. Kienzle, NIST).
   For elements without a standard atomic weight the package gives the mass
   number of the longest-lived isotope; those entries are flagged.

2. data/materials/nist_estar_materials.json
   Elemental compositions (mass fractions) and densities of the 279 materials
   of the NIST ESTAR/PSTAR/ASTAR programs (M.J. Berger et al., NIST Standard
   Reference Database 124; compositions from ICRU Report 37 (1984)), read from
   the lossless HDF5 conversion of the program's composition file shipped with
   ``nist-calculators`` 0.0.5 (MIT licence).

3. data/isotopes/gamma_lines.json
   Discrete gamma-ray lines from the UKAEA DECAY2012 radioactive-decay library
   (distributed as ``lines_decay_2012.min.json`` in ``actigamma`` 0.1.5,
   Apache-2.0, UKAEA).

Usage
-----
    pip install periodictable==2.1.0 nist-calculators==0.0.5 tables actigamma==0.1.5
    python backend/scripts/build_reference_data.py
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
TODAY = date.today().isoformat()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_atomic_weights() -> None:
    import periodictable as pt

    # Elements whose standard atomic weight is not defined by CIAAW
    # (no stable isotope and no characteristic terrestrial composition).
    no_standard = {43, 61} | set(range(84, 90)) | set(range(93, 119))
    elements = []
    for el in pt.elements:
        if el.number == 0 or el.number > 100:
            continue
        elements.append(
            {
                "Z": el.number,
                "symbol": el.symbol,
                "name": el.name.capitalize(),
                "atomic_weight": float(el.mass),
                "uncertainty": float(getattr(el, "_mass_unc", 0.0) or 0.0),
                "standard_atomic_weight": el.number not in no_standard,
            }
        )
    out = {
        "source": "IUPAC/CIAAW standard atomic weights 2021 (abridged)",
        "reference": "T. Prohaska et al., Standard atomic weights of the elements 2021 "
        "(IUPAC Technical Report), Pure Appl. Chem. 94 (2022) 573-600, doi:10.1515/pac-2019-0603",
        "distribution": f"periodictable {pt.__version__} (public domain, P. Kienzle)",
        "notes": [
            "atomic_weight in g/mol (numerically equal to u).",
            "For entries with standard_atomic_weight=false the value is the mass number "
            "of the longest-lived isotope, not a standard atomic weight.",
        ],
        "built": TODAY,
        "elements": elements,
    }
    (DATA / "elements" / "atomic_weights.json").write_text(json.dumps(out, indent=1))
    print(f"atomic weights: {len(elements)} elements")


def build_estar_materials() -> None:
    import star
    import tables

    src = Path(star.__file__).parent / "data" / "NIST_STAR.hdf5"
    materials = []
    with tables.open_file(str(src)) as h5:
        params = h5.root.material_parameters.read()
        for row in params:
            mid = int(row["id"])
            comp = h5.get_node("/composition", f"M{mid:03d}").read()
            materials.append(
                {
                    "estar_id": mid,
                    "name": row["material"].decode().strip(),
                    "density_g_cm3": float(row["density"]),
                    "mean_excitation_energy_eV": float(row["ionisation_potential"]),
                    "mass_fractions": {str(int(c["element"])): float(c["fraction"]) for c in comp},
                }
            )
    out = {
        "source": "NIST ESTAR/PSTAR/ASTAR material composition table",
        "reference": "M.J. Berger, J.S. Coursey, M.A. Zucker, J. Chang, ESTAR, PSTAR, and ASTAR: "
        "Computer Programs for Calculating Stopping-Power and Range Tables for Electrons, "
        "Protons, and Helium Ions, NIST Standard Reference Database 124, doi:10.18434/T4NC7P. "
        "Compositions follow ICRU Report 37 (1984).",
        "url": "https://physics.nist.gov/PhysRefData/Star/Text/method.html",
        "distribution": "HDF5 conversion in nist-calculators 0.0.5 (MIT licence)",
        "source_sha256": sha256(src),
        "notes": ["mass_fractions keyed by atomic number Z; densities in g/cm3 as given by NIST."],
        "built": TODAY,
        "materials": materials,
    }
    (DATA / "materials" / "nist_estar_materials.json").write_text(json.dumps(out, indent=1))
    print(f"ESTAR materials: {len(materials)}")


# Nuclides offered in the isotope selector. Each entry lists the nuclides whose
# gamma lines are shown (daughters in secular equilibrium are listed separately,
# with the parent->daughter branching left to the user: DECAY2012 line
# intensities are per decay of the emitting nuclide).
ISOTOPES = {
    "Cs-137": ["Cs137", "Ba137m"],
    "Co-60": ["Co60"],
    "Na-22": ["Na22"],
    "Am-241": ["Am241"],
    "Ba-133": ["Ba133"],
    "Co-57": ["Co57"],
    "Eu-152": ["Eu152"],
    "Mn-54": ["Mn54"],
    "Zn-65": ["Zn65"],
    "K-40": ["K40"],
    "I-131": ["I131"],
    "Ir-192": ["Ir192"],
    "Se-75": ["Se75"],
    "Cd-109": ["Cd109", "Ag109m"],
    "Y-88": ["Y88"],
}
MIN_INTENSITY_PERCENT = 1.0


def build_isotopes() -> None:
    import actigamma

    src = Path(actigamma.__file__).parent / "data" / "lines_decay_2012.min.json"
    raw = json.loads(src.read_text())
    isotopes = []
    for label, nuclides in ISOTOPES.items():
        lines = []
        for nuc in nuclides:
            rec = raw[nuc]
            g = rec.get("gamma", {}).get("lines")
            if not g:
                continue
            for e, de, i, di, n in zip(
                g["energies"], g["energies_unc"], g["intensities"], g["intensities_unc"], g["norms"]
            ):
                # DECAY2012 stores relative intensities and a normalisation
                # factor; absolute emission probability per decay = I * norm.
                p = i * n * 100.0
                if p < MIN_INTENSITY_PERCENT:
                    continue
                lines.append(
                    {
                        "emitter": nuc,
                        "energy_keV": float(f"{e / 1000.0:.10g}"),
                        "energy_unc_keV": float(f"{de / 1000.0:.10g}"),
                        "intensity_percent": round(p, 6),
                    }
                )
        lines.sort(key=lambda x: -x["intensity_percent"])
        isotopes.append(
            {
                "id": label,
                "emitters": nuclides,
                "half_life_s": raw[nuclides[0]]["halflife"],
                "lines": lines,
            }
        )
    out = {
        "source": "UKAEA DECAY2012 radioactive decay data library",
        "reference": "UKAEA DECAY2012 decay data library (the decay library distributed with "
        "FISPACT-II); line data as distributed in lines_decay_2012.min.json of actigamma 0.1.5 "
        "(UKAEA, Apache-2.0, https://github.com/fispact/actigamma).",
        "source_sha256": sha256(src),
        "notes": [
            "intensity_percent is the absolute emission probability per decay of the emitting nuclide "
            "(relative intensity x normalisation, x100).",
            "Daughter lines (e.g. Ba-137m for Cs-137) are per decay of the daughter; multiply by the "
            "parent->daughter branching fraction for per-parent-decay values.",
            f"Only lines with intensity >= {MIN_INTENSITY_PERCENT}% are included. X-rays and "
            "annihilation photons are not included.",
            "Energies are as tabulated in DECAY2012; ENSDF/DDEP evaluations may quote more digits "
            "(e.g. Co-60 1173.228 keV vs 1173.23 keV here).",
        ],
        "built": TODAY,
        "isotopes": isotopes,
    }
    (DATA / "isotopes" / "gamma_lines.json").write_text(json.dumps(out, indent=1))
    print(f"isotopes: {len(isotopes)}")


if __name__ == "__main__":
    build_atomic_weights()
    build_estar_materials()
    build_isotopes()
