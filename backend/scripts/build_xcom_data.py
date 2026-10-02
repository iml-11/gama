"""Convert the NIST XCOM elemental data files into the JSON files used by the engine.

Source
------
The elemental photon cross sections are the ones distributed with the NIST XCOM
program (data files ``MDATX3.001`` ... ``MDATX3.100``; M.J. Berger, J.H. Hubbell,
S.M. Seltzer et al., NIST Standard Reference Database 8 / XCOM).

The ``nist-calculators`` package (v0.0.5, MIT licence, M. Zelenyi,
https://github.com/Zelenyy/nist-calculators) ships a lossless HDF5 conversion
of those MDATX3 files (``xcom/data/NIST_XCOM.hdf5``). This script reads that
HDF5 file and writes one JSON file per element. No values are modified;
only the layout and units of the energy axis (eV -> MeV) change.

Usage
-----
    pip install nist-calculators==0.0.5 tables
    python backend/scripts/build_xcom_data.py [path/to/NIST_XCOM.hdf5]

or, preferably, directly from the official XCOM distribution files:

    python backend/scripts/build_xcom_data.py --mdatx3 path/to/xcom/directory
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import tables

OUT_DIR = Path(__file__).resolve().parents[1] / "data" / "xcom"

# Atomic weights used internally by the XCOM program (ATWTS array) to convert
# barn/atom to cm2/g. Identical to the ``AtomicWeight`` attribute of the HDF5 file.
XCOM_ATWTS = [
    1.00794, 4.002602, 6.941, 9.012182, 10.811, 12.011, 14.00674, 15.9994,
    18.9984032, 20.1797, 22.989768, 24.3050, 26.981539, 28.0855, 30.973762, 32.066,
    35.4527, 39.948, 39.0983, 40.078, 44.955910, 47.88, 50.9415, 51.9961,
    54.93805, 55.847, 58.93320, 58.69, 63.546, 65.39, 69.723, 72.61,
    74.92159, 78.96, 79.904, 83.80, 85.4678, 87.62, 88.90585, 91.224,
    92.90638, 95.94, 97.9072, 101.07, 102.9055, 106.42, 107.8682, 112.411,
    114.82, 118.710, 121.75, 127.60, 126.90447, 131.29, 132.90543, 137.327,
    138.9055, 140.115, 140.90765, 144.24, 144.9127, 150.36, 151.965, 157.25,
    158.92534, 162.50, 164.93032, 167.26, 168.93421, 173.04, 174.967, 178.49,
    180.9479, 183.85, 186.207, 190.2, 192.22, 195.08, 196.96654, 200.59,
    204.3833, 207.2, 208.98037, 208.9824, 209.9871, 222.0176, 223.0197, 226.0254,
    227.0278, 232.0381, 231.03588, 238.0289, 237.0482, 239.0522, 243.0614, 247.0703,
    247.0703, 251.0796, 252.083, 257.0951,
]


def locate_hdf5() -> Path:
    if len(sys.argv) > 1 and sys.argv[1] != "--mdatx3":
        return Path(sys.argv[1])
    import xcom  # nist-calculators

    return Path(xcom.__file__).parent / "data" / "NIST_XCOM.hdf5"


def annotate_missing_edges(record: dict) -> None:
    """Flag edges whose upper-side photoelectric value is absent from the grid.

    nist-calculators 0.0.5 removed rows with *identical* energies when building
    its HDF5 file (``drop_doubling``). For Z = 87-100 the MDATX3 K-edge is stored
    as two rows with the same energy, so the value just above the K edge was
    dropped and only the lower-side value was kept. We never try to guess the
    missing number: the engine refuses to return photoelectric (and total)
    values between the edge and the next tabulated energy for these elements.
    Rebuilding from the original MDATX3 files (``--mdatx3 DIR``) fixes this.
    """
    energies = record["energy"]
    # Edge pairs: consecutive grid points closer than max(0.15 eV, 1e-5 E).
    pairs = [
        energies[i + 1]
        for i in range(len(energies) - 1)
        if energies[i + 1] - energies[i] < max(1.5e-7, 1e-5 * energies[i])
    ]
    missing = []
    for edge in record["edges"]:
        e = edge["energy"]
        if not any(abs(p - e) <= 1e-3 * e for p in pairs):
            nxt = next(x for x in energies if x > e + 2e-7)
            missing.append({"label": edge["label"], "edge_energy": e, "next_tabulated_energy": nxt})
    record["incomplete_edges"] = missing


def read_mdatx3(path: Path, z: int) -> dict:
    """Parse an original XCOM ``MDATX3.nnn`` file (free-format numbers)."""
    tokens = path.read_text().split()
    pos = 0

    def take(n: int) -> list[str]:
        nonlocal pos
        out = tokens[pos : pos + n]
        pos += n
        return out

    iz, atwt = int(tokens[0]), float(tokens[1])
    pos = 2
    maxedg, maxe = map(int, take(2))
    labels: list[str] = []
    edge_e: list[float] = []
    if maxedg > 0:
        take(maxedg)  # edge indices
        labels = take(maxedg)
        edge_e = [float(v) for v in take(maxedg)]
    cols = [[float(v) for v in take(maxe)] for _ in range(6)]
    record = {
        "Z": iz,
        "atomic_weight_mdatx3": atwt,
        "energy": [float(f"{e:.10g}") for e in cols[0]],
        "coherent": cols[1],
        "incoherent": cols[2],
        "photoelectric": cols[3],
        "pair_nuclear": cols[4],
        "pair_electron": cols[5],
        "edges": [],
    }
    if maxedg > 0:
        lax = int(take(1)[0])
        kmx = [int(v) for v in take(lax)]
        eng = [[float(v) for v in take(k)] for k in kmx]
        phc = [[float(v) for v in take(k)] for k in kmx]
        for label, e, ie, ip in zip(labels, edge_e, eng, phc):
            record["edges"].append(
                {"label": label, "energy": e, "interval_energy": ie, "interval_photoelectric": ip}
            )
        record["edges"].sort(key=lambda d: d["energy"])
    return record


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 2 and sys.argv[1] == "--mdatx3":
        build_from_mdatx3(Path(sys.argv[2]))
    else:
        build_from_hdf5(locate_hdf5())


def write_manifest(elements: list[int], conversion: str, sha256: str) -> None:
    manifest = {
        "dataset": "NIST XCOM: Photon Cross Sections Database (NIST Standard Reference Database 8)",
        "files": "MDATX3.001-MDATX3.100 (XCOM program data files)",
        "authors": "M.J. Berger, J.H. Hubbell, S.M. Seltzer, J. Chang, J.S. Coursey, R. Sukumar, D.S. Zucker, K. Olsen",
        "url": "https://www.nist.gov/pml/xcom-photon-cross-sections-database",
        "doi": "10.18434/T48G6X",
        "conversion": conversion,
        "source_sha256": sha256,
        "built": date.today().isoformat(),
        "elements": elements,
        "energy_range_MeV": [1e-3, 1e5],
        "avogadro_xcom": 0.60221367,
        "notes": [
            "Cross sections in barn/atom. Energies in MeV.",
            "At absorption edges the grid contains two points separated by ~1e-7 MeV "
            "carrying the photoelectric cross section below and above the edge.",
            "atomic_weight_xcom is the atomic-weight table used by the XCOM program "
            "to convert barn/atom to cm2/g.",
            "incomplete_edges lists edges whose upper-side photoelectric value is "
            "missing from the source conversion; the engine refuses to interpolate there.",
        ],
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {len(elements)} element files to {OUT_DIR}")


def build_from_mdatx3(directory: Path) -> None:
    digest = hashlib.sha256()
    elements = []
    for z in range(1, 101):
        path = directory / f"MDATX3.{z:03d}"
        digest.update(path.read_bytes())
        record = read_mdatx3(path, z)
        record["atomic_weight_xcom"] = XCOM_ATWTS[z - 1]
        record["units"] = {"energy": "MeV", "cross_section": "barn/atom"}
        annotate_missing_edges(record)
        (OUT_DIR / f"Z{z:03d}.json").write_text(json.dumps(record, separators=(",", ":")))
        elements.append(z)
    write_manifest(elements, "Parsed directly from MDATX3 files by backend/scripts/build_xcom_data.py", digest.hexdigest())


def build_from_hdf5(src: Path) -> None:
    sha256 = hashlib.sha256(src.read_bytes()).hexdigest()
    elements = []
    with tables.open_file(str(src)) as h5:
        for z in range(1, 101):
            node = h5.get_node(f"/Z{z:03d}", "data")
            data = node.read()
            attrs = node.attrs
            energies_ev = np.asarray(data["energy"], dtype=float)
            if np.any(np.diff(energies_ev) <= 0):
                raise ValueError(f"Z={z}: energy grid is not strictly increasing")
            record = {
                "Z": z,
                "atomic_weight_xcom": float(attrs["AtomicWeight"]),
                "atomic_weight_mdatx3": float(attrs["AtomicWeightMDATX3"]),
                "units": {"energy": "MeV", "cross_section": "barn/atom"},
                # Energies stored in MeV, rounded to remove eV->MeV float noise
                # (MDATX3 energies are given to at most 7 significant digits).
                "energy": [float(f"{e / 1e6:.10g}") for e in energies_ev],
                "coherent": [float(v) for v in data["coherent"]],
                "incoherent": [float(v) for v in data["incoherent"]],
                "photoelectric": [float(v) for v in data["photoelectric"]],
                "pair_nuclear": [float(v) for v in data["pair_atom"]],
                "pair_electron": [float(v) for v in data["pair_electron"]],
                "edges": [],
            }
            if attrs["AbsorptionEdge"]:
                info = h5.get_node(f"/Z{z:03d}/AbsorptionEdge/info").read()
                for row in info:
                    label = row["name"].decode()
                    sub = h5.get_node(f"/Z{z:03d}/AbsorptionEdge/{label}").read()
                    record["edges"].append(
                        {
                            "label": label,
                            # MDATX3 edge energy (upper side of the discontinuity)
                            "energy": float(f"{row['EDGEN'] / 1e6:.10g}"),
                            # Photoelectric cross sections on the interval that
                            # ends at this edge (lower side), used by XCOM for
                            # log-log interpolation below the K edge.
                            "interval_energy": [float(v) for v in sub["energy"]],
                            "interval_photoelectric": [float(v) for v in sub["photoelectric"]],
                        }
                    )
                record["edges"].sort(key=lambda e: e["energy"])
            annotate_missing_edges(record)
            (OUT_DIR / f"Z{z:03d}.json").write_text(json.dumps(record, separators=(",", ":")))
            elements.append(z)

    write_manifest(
        elements,
        "HDF5 conversion from nist-calculators 0.0.5 (MIT licence), converted to JSON by backend/scripts/build_xcom_data.py",
        sha256,
    )


if __name__ == "__main__":
    main()
