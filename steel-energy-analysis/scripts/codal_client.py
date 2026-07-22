"""Resilient Codal client via rotating Iran HTTP proxies."""

from __future__ import annotations

import json
import random
import time
from typing import Any
from urllib.parse import urljoin

import requests


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Referer": "https://codal.ir/",
    "Origin": "https://codal.ir",
    "Accept": "*/*",
    "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
}


class CodalClient:
    def __init__(self, proxies: list[str], min_delay: float = 0.35):
        # proxies may be "host:port" or "scheme|host:port"
        parsed: list[tuple[str, str]] = []
        for raw in proxies:
            raw = raw.strip()
            if not raw:
                continue
            if "|" in raw:
                scheme, host = raw.split("|", 1)
            else:
                scheme, host = "http", raw
            parsed.append((scheme, host))
        self.proxies = parsed
        if not self.proxies:
            raise ValueError("At least one proxy is required")
        self.min_delay = min_delay
        self._i = random.randrange(len(self.proxies))
        self._last = 0.0
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        self.stats = {"ok": 0, "fail": 0}

    def _next_proxy(self) -> tuple[dict[str, str], str]:
        scheme, host = self.proxies[self._i % len(self.proxies)]
        self._i += 1
        proxy_url = f"{scheme}://{host}"
        return {"http": proxy_url, "https": proxy_url}, f"{scheme}|{host}"

    def _throttle(self) -> None:
        elapsed = time.time() - self._last
        if elapsed < self.min_delay:
            time.sleep(self.min_delay - elapsed)

    def request(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        binary: bool = False,
        retries: int = 14,
        timeout: float = 50,
    ) -> bytes | str:
        last_err: Exception | None = None
        for attempt in range(retries):
            self._throttle()
            proxies, proxy = self._next_proxy()
            try:
                resp = self.session.get(
                    url, params=params, proxies=proxies, timeout=timeout
                )
                self._last = time.time()
                if resp.status_code != 200:
                    raise RuntimeError(f"HTTP {resp.status_code} via {proxy}")
                self.stats["ok"] += 1
                return resp.content if binary else resp.content.decode("utf-8", "ignore")
            except Exception as exc:  # noqa: BLE001
                self.stats["fail"] += 1
                last_err = exc
                time.sleep(0.6 + 0.45 * attempt + random.random() * 0.3)
        raise RuntimeError(f"Request failed for {url}: {last_err}")

    def search(self, symbol: str, page: int = 1) -> dict[str, Any]:
        text = self.request(
            "https://search.codal.ir/api/search/v2/q",
            params={"Symbol": symbol, "PageNumber": page, "search": "true"},
        )
        assert isinstance(text, str)
        return json.loads(text)

    def iter_letters(self, symbol: str, max_pages: int = 60):
        for page in range(1, max_pages + 1):
            data = self.search(symbol, page)
            letters = data.get("Letters") or []
            if not letters:
                break
            yield page, letters
            time.sleep(0.15)

    def excel_url(self, letter: dict[str, Any]) -> str | None:
        excel = letter.get("ExcelUrl") or ""
        if not excel:
            return None
        if excel.startswith("http"):
            return excel
        return urljoin("https://codal.ir/", excel.lstrip("/"))

    def download_excel(self, letter: dict[str, Any]) -> bytes:
        url = self.excel_url(letter)
        if not url:
            raise ValueError("Letter has no ExcelUrl")
        content = self.request(url, binary=True, timeout=90)
        assert isinstance(content, bytes)
        return content
