# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Helpers for isolated mesh workers."""


class Cancelled(Exception):
    pass


def local_snapshot(source: dict) -> str:
    from huggingface_hub import snapshot_download

    return snapshot_download(source["repo"], allow_patterns=source.get("patterns"),
                             revision=source.get("revision"), local_files_only=True)
