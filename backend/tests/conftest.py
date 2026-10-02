import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["GAMMA_OFFLINE"] = "1"  # tests never touch the network


@pytest.fixture(autouse=True)
def isolated_user_data(tmp_path, monkeypatch):
    """Custom materials and the PubChem cache go to a temp dir during tests."""
    from science import material_db, pubchem

    monkeypatch.setattr(material_db, "CUSTOM_FILE", tmp_path / "custom.json")
    material_db.get_db.cache_clear()
    pubchem.set_client(pubchem.PubChemClient(cache_file=tmp_path / "pubchem.json"))
    yield
    material_db.get_db.cache_clear()
