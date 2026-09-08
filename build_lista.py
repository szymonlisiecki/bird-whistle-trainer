#!/usr/bin/env python3
"""Build lista/birds.json from Komisja Faunistyczna + xeno-canto via GBIF."""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT_DIR = BASE / "lista"
CACHE = OUT_DIR / ".cache.json"
BIRDS_JSON = OUT_DIR / "birds.json"
KF_URL = "https://komisjafaunistyczna.pl/lista/"
XC_DATASET = "b1047888-ae52-4179-9dd5-5448ea342a24"
UA = "BirdWhistleTrainer/1.0 (personal listening list; +https://github.com/szymonlisiecki/bird-whistle-trainer)"
ROW_RE = re.compile(
    r'<td class="column-1">(\d+)</td>'
    r'<td class="column-2"><em>([^<]+)</em></td>'
    r'<td class="column-3">([^<]*)</td>'
    r'<td class="column-4">([^<]*)</td>'
    r'<td class="column-5">([^<]*)</td>',
    re.I,
)


def http_json(url: str, retries: int = 4):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.load(resp)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def http_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read().decode("utf-8", "replace")


def parse_kf(html: str) -> list[dict]:
    birds = []
    for lp, latin, pl, cat, status in ROW_RE.findall(html):
        birds.append({
            "lp": int(lp),
            "latin": unescape(latin).strip(),
            "pl": unescape(pl).strip(),
            "category": unescape(cat).strip(),
            "status": unescape(status).strip(),
        })
    return birds


def parse_seconds(text: str | None) -> float | None:
    if not text:
        return None
    text = text.strip().lower().replace(",", ".")
    m = re.search(r"(\d+)\s*min(?:ute)?s?\s*(\d+(?:\.\d+)?)\s*s", text)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    m = re.search(r"(\d+):(\d{1,2})(?:\.(\d+))?", text)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.search(r"(\d+(?:\.\d+)?)\s*s\b", text)
    if m:
        return float(m.group(1))
    return None


def rec_from_gbif(item: dict) -> dict | None:
    catalog = (item.get("catalogNumber") or "").strip()
    m = re.search(r"(\d+)", catalog) or re.search(r"(\d+)", str(item.get("identifier") or ""))
    if not m:
        return None
    xc = m.group(1)
    media = item.get("media") or []
    has_mp3 = any(
        (x.get("type") == "Sound") and ("mpeg" in (x.get("format") or "") or str(x.get("identifier") or "").endswith(".mp3"))
        for x in media
    )
    length = None
    rating = None
    for block in (item.get("extensions") or {}).get("http://rs.tdwg.org/ac/terms/Multimedia") or []:
        if "sound" in (block.get("http://purl.org/dc/elements/1.1/type") or "").lower() or "audio" in (block.get("http://purl.org/dc/terms/format") or ""):
            length = length or parse_seconds(block.get("http://purl.org/dc/terms/description"))
            r = block.get("http://ns.adobe.com/xap/1.0/Rating")
            if r is not None:
                try:
                    rating = float(r)
                except ValueError:
                    pass
    if length is None:
        for x in media:
            if x.get("type") == "Sound":
                length = parse_seconds(x.get("description"))
    behavior = (item.get("behavior") or "").strip().lower()
    return {
        "xc": xc,
        "type": behavior or "",
        "country": item.get("country") or "",
        "countryCode": item.get("countryCode") or "",
        "length": round(length) if length else None,
        "mp3": has_mp3,
        "rating": rating,
    }


def score(rec: dict) -> tuple:
    kind = rec["type"]
    song = 2 if "song" in kind else 1 if "call" in kind else 0
    pl = 1 if rec["countryCode"] == "PL" else 0
    mp3 = 1 if rec["mp3"] else 0
    dur = rec["length"] or 0
    dur_ok = 1 if 6 <= dur <= 90 else 0 if dur == 0 else -1
    rating = rec["rating"] if rec["rating"] is not None else 2.5
    return (song, pl, mp3, dur_ok, rating, -(dur or 9999))


def pick_recordings(items: list[dict], n: int = 4) -> list[dict]:
    seen = set()
    parsed = []
    for item in items:
        rec = rec_from_gbif(item)
        if not rec or rec["xc"] in seen:
            continue
        seen.add(rec["xc"])
        parsed.append(rec)
    parsed.sort(key=score, reverse=True)
    out = []
    for rec in parsed[:n]:
        out.append({
            "xc": rec["xc"],
            "type": rec["type"] or "unknown",
            "country": rec["country"],
            "length": rec["length"],
        })
    return out


SYNONYMS = {
    "Astur gentilis": "Accipiter gentilis",
    "Tachyspiza brevipes": "Accipiter brevipes",
    "Chloris chloris": "Carduelis chloris",
    "Emberiza aureola": None,  # resolved via GBIF taxonKey
}


def fetch_recordings(latin: str) -> list[dict]:
    names = [latin]
    if latin in SYNONYMS and SYNONYMS[latin]:
        names.append(SYNONYMS[latin])
    for name in names:
        q = urllib.parse.quote(name)
        url = (
            "https://api.gbif.org/v1/occurrence/search"
            f"?datasetKey={XC_DATASET}&scientificName={q}&limit=40"
        )
        data = http_json(url)
        recs = pick_recordings(data.get("results") or [])
        if recs:
            return recs
        match = http_json(f"https://api.gbif.org/v1/species/match?name={q}")
        key = match.get("usageKey") or match.get("speciesKey") or match.get("acceptedUsageKey")
        if not key:
            continue
        url = (
            "https://api.gbif.org/v1/occurrence/search"
            f"?datasetKey={XC_DATASET}&taxonKey={key}&limit=40"
        )
        data = http_json(url)
        recs = pick_recordings(data.get("results") or [])
        if recs:
            return recs
    return []


def load_cache() -> dict:
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    print("Pobieram listę Komisji Faunistycznej…")
    html = http_text(KF_URL)
    birds = parse_kf(html)
    if len(birds) < 100:
        raise SystemExit(f"Za mało gatunków na liście KF: {len(birds)}")
    print(f"  {len(birds)} gatunków")

    cache = load_cache()
    built = []
    missing = 0
    for i, bird in enumerate(birds, 1):
        latin = bird["latin"]
        if latin in cache:
            recs = cache[latin]
        else:
            try:
                recs = fetch_recordings(latin)
            except Exception as e:
                print(f"  ! {latin}: {e}")
                recs = []
            cache[latin] = recs
            if i % 10 == 0:
                CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            time.sleep(0.12)
        if not recs:
            missing += 1
        built.append({**bird, "recordings": recs})
        if i % 25 == 0 or i == len(birds):
            print(f"  {i}/{len(birds)}  bez nagrania: {missing}")

    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    payload = {
        "source": KF_URL,
        "sourceNote": "Gatunki ptaków stwierdzone w Polsce. Stan z 01.06.2026, Komisja Faunistyczna / AviList.",
        "recordingsSource": "https://xeno-canto.org/",
        "count": len(built),
        "withRecordings": sum(1 for b in built if b["recordings"]),
        "birds": built,
    }
    BIRDS_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Zapisano {BIRDS_JSON} ({payload['withRecordings']}/{payload['count']} z nagraniem).")


if __name__ == "__main__":
    main()
