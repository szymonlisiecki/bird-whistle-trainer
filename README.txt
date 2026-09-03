BIRD WHISTLE TRAINER — FINAL

To jest poprawiona wersja. Poprzedni błąd „not enough values to unpack” wynikał
z tego, że lista ptaków została zapisana jako tekst zamiast listy krotek.

1. Rozpakuj ZIP.
2. Terminal:
   cd ~/Downloads/bird_whistle_trainer_local_final
3. Pobierz MP3:
   python3 download.py
4. Uruchom serwer:
   python3 -m http.server 8001
5. Otwórz:
   http://localhost:8001

Jeśli 8001 jest zajęty:
   python3 -m http.server 8002
   http://localhost:8002

Po pobraniu pliki będą w audio/ jako XC_ID.mp3.

Waveform: w tabeli jest podgląd fali audio; kliknięcie lub przeciąganie po fali przewija nagranie.
