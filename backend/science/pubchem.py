"""PubChem PUG REST client with a local JSON cache.

PubChem is used ONLY for chemical identity (name -> CID, molecular formula,
molecular weight, synonyms). It is never used as a source of attenuation data.

Successful look-ups are cached in ``data/cache/pubchem_cache.json`` with the
retrieval date, so repeated queries (and offline mode) need no network.
Failed look-ups are never turned into a composition.

Online access can be disabled with the environment variable
``GAMMA_OFFLINE=1`` or per request.
"""

from __future__ import annotations

import json
import os
import threading
import urllib.parse
from datetime import datetime, timezone

import httpx

from .paths import CACHE_DIR

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
AUTOCOMPLETE = "https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound"
CACHE_FILE = CACHE_DIR / "pubchem_cache.json"
PROPERTIES = "Title,IUPACName,MolecularFormula,MolecularWeight,InChIKey"


class PubChemUnavailable(RuntimeError):
    """Network/service failure (distinct from 'compound not found')."""


def online_enabled() -> bool:
    return os.environ.get("GAMMA_OFFLINE", "").strip() not in ("1", "true", "yes")


class PubChemClient:
    def __init__(self, cache_file=CACHE_FILE, transport: httpx.BaseTransport | None = None, timeout: float = 8.0):
        self.cache_file = cache_file
        self._lock = threading.Lock()
        self._client = httpx.Client(timeout=timeout, transport=transport, headers={"User-Agent": "gamma-attenuation-app/1.0"})
        self._cache = self._read_cache()
        self._negative: set[str] = set()

    # ------------------------------------------------------------ cache
    def _read_cache(self) -> dict:
        try:
            return json.loads(self.cache_file.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return {"entries": {}}

    def _write_cache(self) -> None:
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._cache, indent=1))
        tmp.replace(self.cache_file)

    @staticmethod
    def _key(name: str) -> str:
        return " ".join(name.strip().lower().split())

    def cached(self, name: str) -> dict | None:
        return self._cache["entries"].get(self._key(name))

    def cached_entries(self) -> list[dict]:
        return list(self._cache["entries"].values())

    # ------------------------------------------------------------ network
    def _get(self, url: str) -> httpx.Response:
        try:
            r = self._client.get(url)
        except httpx.HTTPError as exc:
            raise PubChemUnavailable(f"PubChem request failed: {exc.__class__.__name__}") from exc
        if r.status_code >= 500 or r.status_code in (403, 429, 503):
            raise PubChemUnavailable(f"PubChem returned HTTP {r.status_code}")
        return r

    def lookup(self, name: str, online: bool = True) -> dict | None:
        """Resolve a chemical name. Returns the cached record or None if not found.

        Raises PubChemUnavailable when online lookup is needed but fails.
        """
        key = self._key(name)
        hit = self._cache["entries"].get(key)
        if hit:
            return {**hit, "from_cache": True}
        if not online or not online_enabled():
            return None
        if key in self._negative:
            return None
        q = urllib.parse.quote(name.strip(), safe="")
        r = self._get(f"{PUG}/compound/name/{q}/property/{PROPERTIES}/JSON")
        if r.status_code == 404:
            self._negative.add(key)
            return None
        if r.status_code != 200:
            raise PubChemUnavailable(f"PubChem returned HTTP {r.status_code}")
        props = r.json().get("PropertyTable", {}).get("Properties", [])
        if not props:
            self._negative.add(key)
            return None
        p = props[0]
        cid = int(p["CID"])
        synonyms: list[str] = []
        try:
            rs = self._get(f"{PUG}/compound/cid/{cid}/synonyms/JSON")
            if rs.status_code == 200:
                info = rs.json().get("InformationList", {}).get("Information", [])
                if info:
                    synonyms = info[0].get("Synonym", [])[:15]
        except PubChemUnavailable:
            pass
        rec = {
            "query": name.strip(),
            "cid": cid,
            "title": p.get("Title"),
            "iupac_name": p.get("IUPACName"),
            "formula": p.get("MolecularFormula"),
            "molecular_weight": float(p["MolecularWeight"]) if p.get("MolecularWeight") else None,
            "inchikey": p.get("InChIKey"),
            "synonyms": synonyms,
            "other_cids": [int(x["CID"]) for x in props[1:6]],
            "retrieved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "PubChem PUG REST",
            "url": f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}",
        }
        with self._lock:
            self._cache["entries"][key] = rec
            self._write_cache()
        return {**rec, "from_cache": False}

    def autocomplete(self, q: str, limit: int = 6, online: bool = True) -> list[str]:
        if not online or not online_enabled() or len(q.strip()) < 3:
            return []
        try:
            r = self._get(f"{AUTOCOMPLETE}/{urllib.parse.quote(q.strip(), safe='')}/json?limit={limit}")
            if r.status_code != 200:
                return []
            return r.json().get("dictionary_terms", {}).get("compound", [])[:limit]
        except (PubChemUnavailable, ValueError):
            return []


_client: PubChemClient | None = None


def get_client() -> PubChemClient:
    global _client
    if _client is None:
        _client = PubChemClient()
    return _client


def set_client(client: PubChemClient) -> None:
    global _client
    _client = client
