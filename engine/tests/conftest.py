# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

import pytest


@pytest.fixture(autouse=True)
def french_by_default():
    """The texts of the code are French: the tests read them as written, unless one asks for English (tests/test_i18n.py)."""
    from app import i18n

    i18n.set_language("fr")
    yield
    i18n.set_language("fr")
