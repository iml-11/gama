"""Reference list shown on the References page. Only real, verifiable sources."""

REFERENCES = [
    {
        "topic": "Photon attenuation data",
        "items": [
            {
                "id": "xcom",
                "citation": "M.J. Berger, J.H. Hubbell, S.M. Seltzer, J. Chang, J.S. Coursey, R. Sukumar, D.S. Zucker, K. Olsen, "
                "XCOM: Photon Cross Sections Database, NIST Standard Reference Database 8 (XGAM), National Institute of "
                "Standards and Technology, Gaithersburg, MD.",
                "doi": "10.18434/T48G6X",
                "url": "https://www.nist.gov/pml/xcom-photon-cross-sections-database",
                "used_for": "Elemental coherent, incoherent, photoelectric and pair-production cross sections (Z = 1-100, 1 keV-100 GeV).",
            },
            {
                "id": "xcom-method",
                "citation": "M.J. Berger, J.H. Hubbell, XCOM: Photon Cross Sections on a Personal Computer, NBSIR 87-3597, "
                "National Bureau of Standards (1987).",
                "url": "https://www.nist.gov/pml/xcom-photon-cross-sections-database",
                "used_for": "Mixture rule and log-log interpolation methodology, treatment of absorption edges.",
            },
            {
                "id": "nist-calculators",
                "citation": "M. Zelenyi, nist-calculators 0.0.5 (MIT licence): lossless HDF5 conversion of the XCOM MDATX3 data files.",
                "url": "https://pypi.org/project/nist-calculators/",
                "used_for": "Distribution format of the XCOM data files converted by backend/scripts/build_xcom_data.py.",
            },
        ],
    },
    {
        "topic": "Attenuation methodology",
        "items": [
            {
                "id": "hubbell-seltzer",
                "citation": "J.H. Hubbell, S.M. Seltzer, Tables of X-Ray Mass Attenuation Coefficients and Mass Energy-Absorption "
                "Coefficients, NISTIR 5632 (1995), NIST Standard Reference Database 126.",
                "doi": "10.18434/T4D01F",
                "url": "https://www.nist.gov/pml/x-ray-mass-attenuation-coefficients",
                "used_for": "Definitions of mu/rho, mu, narrow-beam attenuation; validation values.",
            },
        ],
    },
    {
        "topic": "Atomic weights and constants",
        "items": [
            {
                "id": "iupac-2021",
                "citation": "T. Prohaska et al., Standard atomic weights of the elements 2021 (IUPAC Technical Report), "
                "Pure Appl. Chem. 94 (2022) 573-600.",
                "doi": "10.1515/pac-2019-0603",
                "url": "https://www.ciaaw.org/atomic-weights.htm",
                "used_for": "Molar masses and elemental mass fractions from chemical formulas (abridged values, via the "
                "public-domain periodictable 2.1.0 package).",
            },
            {
                "id": "codata-2018",
                "citation": "E. Tiesinga, P.J. Mohr, D.B. Newell, B.N. Taylor, CODATA recommended values of the fundamental "
                "physical constants: 2018, Rev. Mod. Phys. 93 (2021) 025010.",
                "doi": "10.1103/RevModPhys.93.025010",
                "used_for": "Electron rest energy for pair-production thresholds.",
            },
        ],
    },
    {
        "topic": "Material compositions and densities",
        "items": [
            {
                "id": "estar",
                "citation": "M.J. Berger, J.S. Coursey, M.A. Zucker, J. Chang, ESTAR, PSTAR, and ASTAR: Computer Programs for "
                "Calculating Stopping-Power and Range Tables for Electrons, Protons, and Helium Ions, NIST Standard "
                "Reference Database 124.",
                "doi": "10.18434/T4NC7P",
                "url": "https://physics.nist.gov/PhysRefData/Star/Text/method.html",
                "used_for": "Elemental compositions and densities of 279 reference materials (elements, polymers, glasses, "
                "concrete, compounds).",
            },
            {
                "id": "icru37",
                "citation": "ICRU Report 37, Stopping Powers for Electrons and Positrons, International Commission on "
                "Radiation Units and Measurements, Bethesda, MD (1984).",
                "used_for": "Source of the NIST ESTAR material compositions.",
            },
            {
                "id": "repeat-units",
                "citation": "Polymer repeat-unit formulas follow the structure-based IUPAC names of the polymers; elemental "
                "fractions are computed, not tabulated.",
                "used_for": "Compositions of PMMA, PE, PET, PVA, PVC, PEEK, PLA, PS, PC and other polymers.",
            },
        ],
    },
    {
        "topic": "Chemical identity",
        "items": [
            {
                "id": "pubchem",
                "citation": "S. Kim et al., PubChem 2023 update, Nucleic Acids Res. 51 (2023) D1373-D1380.",
                "doi": "10.1093/nar/gkac956",
                "url": "https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest",
                "used_for": "Name -> CID, molecular formula, molecular weight and synonyms (PUG REST). Never used for "
                "attenuation data.",
            },
        ],
    },
    {
        "topic": "Isotope gamma-ray energies",
        "items": [
            {
                "id": "decay2012",
                "citation": "UKAEA DECAY2012 radioactive decay data library (decay library of FISPACT-II), line data as "
                "distributed in actigamma 0.1.5 (UKAEA, Apache-2.0).",
                "url": "https://github.com/fispact/actigamma",
                "used_for": "Gamma-ray energies and emission probabilities in the isotope selector.",
            },
        ],
    },
]
