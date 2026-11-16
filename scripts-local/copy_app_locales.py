#!/usr/bin/env python3
# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Stage the app-owned Nest JSON dictionaries for desktop (the template collects shared module locales only)."""

from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def stage_locales(source: Path, destination: Path) -> int:
    """Refresh module i18n/locales together, retaining the paths expected by Nest at runtime."""
    shutil.rmtree(destination, ignore_errors=True)
    destination.mkdir(parents=True)
    count = 0
    for folder in ('i18n', 'locales'):
        for path in sorted(source.glob(f'*/{folder}/*.json')):
            target = destination / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
            count += 1
    return count


if __name__ == '__main__':
    count = stage_locales(ROOT / 'back/src/modules', ROOT / 'desktop/build/engine-bundle/app-locales')
    print(f'[desktop] {count} application server dictionaries staged')
