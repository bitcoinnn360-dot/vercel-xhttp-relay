#!/usr/bin/env python3
"""
Optional scrapers for TSETMC / IME when direct APIs are blocked.
Run locally or on a server with Iranian network access:

  python scripts/scrape_market.py

Writes JSON into public/data/scraped.json for the dashboard to optionally load.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "data" / "scraped.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; MIDCODashboard/1.0)"}


def fetch(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def scrape_tgju_bourse() -> dict:
    """Preferred path: TGJU already mirrors TEDPIX."""
    raw = fetch("https://call2.tgju.org/ajax.json")
    data = json.loads(raw)
    row = (data.get("current") or {}).get("bourse") or {}
    def num(x):
        if x is None:
            return None
        return float(re.sub(r"[^\d.-]", "", str(x).replace(",", "")))
    return {
        "tedpix": num(row.get("p")),
        "change": num(row.get("d")),
        "changePct": num(row.get("dp")),
        "source": "tgju",
    }


def scrape_tsetmc_home() -> dict:
    """Best-effort TSETMC homepage parse (often geo-blocked)."""
    try:
        html = fetch("https://cdn.tsetmc.com/api/Index/GetIndexB1LastDay/32097828799138957")
        # Some CDN JSON endpoints exist; treat as opaque passthrough when available
        return {"raw": json.loads(html), "source": "tsetmc-cdn"}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "source": "tsetmc", "status": "blocked"}


def scrape_ime_home() -> dict:
    """Best-effort IME homepage (may require Iran IP)."""
    try:
        html = fetch("https://www.ime.co.ir/")
        title = re.search(r"<title>(.*?)</title>", html, re.I)
        return {
            "ok": True,
            "title": title.group(1).strip() if title else None,
            "bytes": len(html),
            "source": "ime",
            "note": "Full trade tables need authenticated/IME-specific endpoints; hook here later.",
        }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc), "source": "ime", "status": "blocked"}


def main() -> int:
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "tgjuBourse": scrape_tgju_bourse(),
        "tsetmc": scrape_tsetmc_home(),
        "ime": scrape_ime_home(),
        "custeelAlternative": {
            "note": "Use TGJU base-us-iron-ore + base-us-steel-coil and FRED PIORECRUSDM until Custeel is available.",
            "providers": ["tgju", "fred", "mysteel(paid)", "steelhome(paid)"],
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")
    print(json.dumps(payload["tgjuBourse"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
