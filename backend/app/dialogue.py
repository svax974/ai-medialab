"""Scénario à plusieurs voix : « Nom : réplique » -> segments, un par réplique, chacun avec sa voix."""

from __future__ import annotations

import re
from typing import Any

# Un nom court en début de ligne, éventuellement entre crochets : « Alice : », « [Marc] : », « Le narrateur: ».
LINE = re.compile(r"^\s*[\[\(]?\s*([^\W\d_][\w .'’\-]{0,28}?)\s*[\]\)]?\s*[:：]\s*(.*)$", re.UNICODE)


def speakers_in(text: str) -> list[str]:
    """Noms qui ouvrent au moins une ligne, dans l'ordre d'apparition (la détection que fait l'interface)."""
    seen: list[str] = []
    for line in text.splitlines():
        m = LINE.match(line)
        if m and m.group(2).strip() and m.group(1).strip() not in seen:
            seen.append(m.group(1).strip())
    return seen


def parse_dialogue(text: str, cast: dict[str, dict[str, Any]], default: dict[str, Any]) -> list[dict[str, Any]]:
    """Découpe en répliques. Seuls les noms présents dans `cast` sont des locuteurs : « Note : … » reste du texte.

    Une ligne qui n'ouvre pas sur un nom prolonge la réplique précédente ; une ligne vide y ajoute une pause."""
    lookup = {name.casefold(): (name, voice) for name, voice in cast.items()}
    segments: list[dict[str, Any]] = []
    pause = False
    for line in text.splitlines():
        if not line.strip():
            pause = bool(segments)
            continue
        m = LINE.match(line)
        who = lookup.get(m.group(1).strip().casefold()) if m else None
        if who:
            name, voice = who
            segments.append({"text": m.group(2).strip(), "voice": {**voice, "label": name}, "label": name})
        elif segments:
            sep = "\n\n" if pause else " "
            segments[-1]["text"] = f"{segments[-1]['text'].rstrip()}{sep}{line.strip()}"
        else:
            segments.append({"text": line.strip(), "voice": default, "label": None})
        pause = False
    return [s for s in segments if s["text"].strip()]
