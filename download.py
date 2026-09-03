#!/usr/bin/env python3
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = Path(__file__).resolve().parent
AUDIO = BASE / "audio"
AUDIO.mkdir(exist_ok=True)

BIRDS = [('Strzyżyk', 'Troglodytes troglodytes', '913172'), ('Wilga', 'Oriolus oriolus', '1023757'), ('Szczygieł', 'Carduelis carduelis', '819266'), ('Płomykówka', 'Tyto alba', '1023248'), ('Głuszec', 'Tetrao urogallus', '877539'), ('Wodnik', 'Rallus aquaticus', '980550'), ('Kulczyk', 'Serinus serinus', '744186'), ('Nur czarnoszyi', 'Gavia arctica', '610925'), ('Sroka', 'Pica pica', '919248'), ('Dzięcioł zielonosiwy', 'Picus canus', '707236'), ('Kulik wielki', 'Numenius arquata', '896531'), ('Słowik szary', 'Luscinia luscinia', '930014'), ('Zaroślówka', 'Acrocephalus dumetorum', '569385'), ('Kszyk', 'Gallinago gallinago', '614529'), ('Zaganiacz', 'Hippolais icterina', '809739'), ('Brzegówka', 'Riparia riparia', '727582'), ('Ostrygojad', 'Haematopus ostralegus', '824414'), ('Ostrygojad', 'Haematopus ostralegus', '824427'), ('Mewa siwa', 'Larus canus', '1167643'), ('Mewa siwa', 'Larus canus', '575730'), ('Bielik', 'Haliaeetus albicilla', '779724'), ('Czapla siwa', 'Ardea cinerea', '1104143')]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36"

for name, latin, xc in BIRDS:
    target = AUDIO / f"{xc}.mp3"
    if target.exists() and target.stat().st_size > 5000:
        print(f"✓ {name} — już pobrane")
        continue

    url = f"https://xeno-canto.org/{xc}/download"
    print(f"↓ {name} — XC{xc}")

    try:
        req = Request(url, headers={
            "User-Agent": UA,
            "Referer": f"https://xeno-canto.org/{xc}",
            "Accept": "audio/mpeg,audio/ogg,*/*"
        })
        with urlopen(req, timeout=90) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type", "")

        # Don't save an HTML error page as an MP3.
        if data[:100].lower().lstrip().startswith((b"<!doctype", b"<html", b"<head")):
            raise RuntimeError("serwer zwrócił HTML zamiast nagrania")

        if len(data) < 5000:
            raise RuntimeError(f"odpowiedź jest za mała ({len(data)} B)")

        target.write_bytes(data)
        print(f"  ✓ {target.name} — {len(data)/1024/1024:.2f} MB — {content_type}")

    except HTTPError as e:
        print(f"  ✗ HTTP {e.code}: {e.reason}")
    except URLError as e:
        print(f"  ✗ problem sieciowy: {e.reason}")
    except Exception as e:
        print(f"  ✗ {e}")

print("\nGotowe.")
print("Uruchom apkę:")
print("  python3 -m http.server 8001")
print("  http://localhost:8001")
