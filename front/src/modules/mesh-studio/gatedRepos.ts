/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Construct a Hugging Face link only for an owner/repository ID, never an arbitrary URL. */
export function gatedRepoUrl(repo: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repo)
    ? `https://huggingface.co/${repo}`
    : null
}
