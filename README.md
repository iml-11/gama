# Gamma Attenuation

A web application for gamma-ray attenuation and shielding calculations based on
the NIST XCOM photon cross-section database. You type a material name, formula,
polymer or composite description and the app works out the elemental
composition automatically. You never enter weight fractions by hand unless you
want to.

```
frontend/   Next.js 15 + React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + Plotly
backend/    Python scientific engine (NumPy, SciPy) + FastAPI
  science/  formula_parser, composition, composite_parser, material_resolver,
            material_db, pubchem, xcom_engine, interpolation, shielding, isotopes
  api/      FastAPI routes (no scientific logic)
  data/     xcom/ (NIST XCOM, Z = 1-100), elements/, materials/, isotopes/, cache/
  scripts/  build scripts that regenerate data/ from the original sources
  tests/    pytest suite
```

## Running

```bash
# Backend (port 8000)
cd backend
pip install -r requirements.txt
uvicorn api.main:app --port 8000
python -m pytest            # 171 tests

# Frontend (port 3000; /api/* is proxied to BACKEND_URL, default http://127.0.0.1:8000)
cd frontend
npm install
npm run dev                 # or: npm run build && npm start
```

Set `GAMMA_OFFLINE=1` to disable PubChem look-ups on the server. The Online/Offline switch in the header does the same for one browser.

## What it does

* **Smart material input** with autocomplete (names, aliases, formulas). It accepts:
  * chemical formulas: `Bi2WO6`, `Ca3(PO4)2`, `CuSO4·5H2O`, `Fe0.7Ni0.3`
  * polymer repeat units: `(C5H8O2)n`, `-(CH2-CH2)-n`
  * database names and aliases: `PMMA`, `acrylic`, `HDPE`, `bismuth wolframate`, `lead`
  * composites: `60 wt% Bi2WO6 + 40 wt% epoxy`, `30 wt% Bi2O3 / epoxy`, `Bi2WO6/PMMA 70/30`,
    `Bi2WO6 epoxy composite with 60% filler`, `epoxy composite with 60 wt% Bi2WO6`, `60 wt% W in PMMA`,
    `20 vol% W + 80 vol% PMMA` (vol% needs a density for every component)
* **Resolution order:** user custom materials → curated database / aliases → chemical formula → local PubChem cache → PubChem PUG REST (online) → *not found*. Curated entries are checked before PubChem on purpose, because PubChem does not give reliable compositions for polymers and formulated materials. When a string is both an alias and a valid formula (`PVC`, `PLA`, `PS`), the alias wins and the formula reading is offered as an alternative (`formula:PVC`).
* **Ambiguous materials** (epoxy, silicone, concrete, glass, lead glass, borated PE) never resolve silently. The user must pick a preset (each shows its composition, density, source and a warning) or enter a custom composition.
* **Composition verification card:** molar mass, atom counts, wt% per element, 100.00 % total, composite components, data provenance, warnings. The composition can be edited by hand.
* **Energy input:** eV, keV, MeV or GeV, or a gamma source (15 radionuclides, lines ≥ 1 %).
* **Results:** μ/ρ (with or without coherent scattering), all partial cross sections, μ, HVL, TVL, MFP, transmission and shielding efficiency. Thickness in mm, cm or m. Density can be left blank; density-dependent outputs are then disabled.
* **Calculation details drawer:** composition, energy, density assumption, dataset, DOI, source SHA-256, interpolation method, constants and equations.
* **Log-log plots** of all interaction components with absorption-edge markers.
* **Compare** up to 8 materials. μ, HVL, TVL and transmission are compared only when every material has a density.
* **Experimental data:** enter μ or μ/ρ per energy, or import a CSV. Shows percent difference, relative error and summary statistics, plots theory against experiment, and exports a CSV.
* **Material database browser** and **custom material creator** (formula mode, or elemental wt% mode checked to sum to 100 ± 0.5 %).
* **References page** listing every data source. Light and dark mode; responsive down to tablet width.

## Scientific approach

* **Composition** is always stored as elemental *mass* fractions. Formula → fractions uses IUPAC/CIAAW 2021 standard atomic weights. Mixtures add mass fractions (`w_i = Σ_k W_k w_i(k)`). Atom and mass fractions are never mixed.
* **Polymers** are described by their ideal repeat unit. Elemental fractions do not depend on chain length, so no molecular weight is needed.
* **Attenuation** uses the mixture rule `(μ/ρ) = Σ w_i (μ/ρ)_i` with `(μ/ρ)_i = σ_i N_A / A_i`. σ comes from the XCOM elemental data. N_A and A_i are the values the XCOM program itself uses, so elemental results reproduce XCOM exactly.
* **Interpolation** (documented in `backend/science/interpolation.py`):
  * log-log cubic splines for coherent and incoherent scattering;
  * pair production is interpolated as `ln[σ/(1-E_th/E)^3]` against ln E, and is zero below threshold;
  * photoelectric absorption uses a log-log cubic spline above the K edge, and piecewise log-log linear interpolation inside each inter-edge interval below it, using the interval nodes shipped in the XCOM data files. No interpolation ever spans an absorption edge.
  * At tabulated energies the exact XCOM values are returned. At an edge energy the value just above the edge is returned.
* **Shielding** results are for narrow-beam (good) geometry. Build-up from scattered photons is not included.

## Data provenance

| Data | Source | File |
|---|---|---|
| Photon cross sections, Z = 1–100, 1 keV–100 GeV | NIST XCOM (SRD 8, doi:10.18434/T48G6X), MDATX3 files via the lossless HDF5 conversion in `nist-calculators` 0.0.5 | `backend/data/xcom/` (`scripts/build_xcom_data.py`) |
| Atomic weights | IUPAC/CIAAW 2021 abridged (Prohaska et al. 2022), via `periodictable` 2.1.0 | `backend/data/elements/atomic_weights.json` |
| Reference material compositions and densities (279 materials) | NIST ESTAR/PSTAR/ASTAR composition table (SRD 124, ICRU Report 37) | `backend/data/materials/nist_estar_materials.json` |
| Polymers, presets, ambiguous families | Hand-curated: repeat-unit formulas, derived stoichiometry, densities only where NIST gives one | `backend/data/materials/curated_materials.json` |
| Gamma lines | UKAEA DECAY2012 library, via `actigamma` 0.1.5 | `backend/data/isotopes/gamma_lines.json` |
| Chemical identity for unknown names | PubChem PUG REST (cached with CID and retrieval date) | `backend/data/cache/pubchem_cache.json` |

`backend/scripts/build_reference_data.py` regenerates the atomic weights, ESTAR and isotope files; its dependencies are in `requirements-build.txt`. None of these values were typed in by hand.

## Validation (backend tests)

* At all XCOM grid energies, the partial cross sections equal the tabulated XCOM values exactly (checked for 12 elements, H to U).
* Published NIST values are reproduced to 4 significant figures: Pb at 0.1, 0.5 and 1 MeV; Fe, Al and water at 1 MeV.
* K and L1–L3 edges of W, Pb and Bi: the photoelectric jump is present, the value just below each edge equals the tabulated lower-side value, coherent and incoherent scattering are continuous across the edge, and nothing is smeared across the jump. Log-log linearity inside the L3 interval is checked.
* Between grid points, values stay bracketed by and monotonic with the neighbouring nodes. Pair production is zero below threshold and increasing above it.
* Formula parsing, mass fractions (Bi₂WO₆ = 697.79 g/mol), polymer compositions matching the NIST ESTAR table to 2×10⁻⁴, composite forms, fraction-sum errors, vol% conversion, unit conversions, HVL/TVL/MFP/transmission, the PubChem client with a mocked transport (cache, provenance, failure → no invented data), custom materials, and the API endpoints.

## Known limitations

* **PubChem was not tested against the live service.** The build environment could not reach pubchem.ncbi.nlm.nih.gov, so the client is tested only with a mocked transport. It follows the documented PUG REST endpoints.
* **Comparison with the XCOM web form:** physics.nist.gov was also unreachable. Between grid points, agreement with the XCOM program depends on its spline boundary conditions, which are not published with the data. The results equal the tabulated data at every grid energy.
* **Z = 87–100 K edge:** the HDF5 conversion dropped the photoelectric value just above the K edge for these elements. The engine refuses to return photoelectric or total values between that edge and the next grid energy (e.g. U: 115.6–150 keV) instead of guessing. Rebuilding from the original MDATX3 files (`build_xcom_data.py --mdatx3 DIR`) fixes this.
* **Isotope energies** come from DECAY2012 with its tabulated precision (for example Co-60 1173.23 and 1332.49 keV; ENSDF quotes 1173.228 and 1332.492 keV). Daughter lines (e.g. Ba-137m for Cs-137) are given per decay of the daughter. Annihilation photons and X-rays are not listed.
* **Densities:** where no sourced density exists (PEEK, PLA, HDPE, LDPE, epoxy presets, most inorganic fillers) the field stays blank and the user must supply a value. Composite densities are only offered as an explicitly labelled ideal-mixture estimate.
