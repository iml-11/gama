from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
XCOM_DIR = DATA_DIR / "xcom"
ELEMENTS_FILE = DATA_DIR / "elements" / "atomic_weights.json"
ESTAR_FILE = DATA_DIR / "materials" / "nist_estar_materials.json"
CURATED_FILE = DATA_DIR / "materials" / "curated_materials.json"
ISOTOPES_FILE = DATA_DIR / "isotopes" / "gamma_lines.json"
CACHE_DIR = DATA_DIR / "cache"
USER_DIR = DATA_DIR / "user"
