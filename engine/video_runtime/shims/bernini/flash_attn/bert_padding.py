# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Names imported from `flash_attn.bert_padding` by Bernini's (unused) planner code."""


def unpad_input(*_args, **_kwargs):
    raise NotImplementedError("FlashAttention n'est pas installé (code du planificateur Bernini, inutilisé ici).")


pad_input = index_first_axis = unpad_input
