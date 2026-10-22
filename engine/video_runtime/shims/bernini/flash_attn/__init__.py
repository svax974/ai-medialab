# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Stand-in for the `flash_attn` package, which Bernini's pack cannot install without a compiler.

`bernini/models/modeling_qwen2_5_vl.py` refuses to import unless `flash_attn` can be found, yet the renderer never runs
that code (it belongs to the full Bernini planner) and `bernini/attention.py` falls back to PyTorch SDPA when FlashAttention is
missing. This module is only there to satisfy the import. Its variable-length function is a plain SDPA implementation, because
`bernini.attention` would otherwise pick it up as the "fa2" backend. There is no package metadata next to it, so
`transformers` still reports FlashAttention as unavailable. Must not import torch at module level.
"""

__version__ = "0.0.0+sdpa-shim"


def flash_attn_varlen_func(q, k, v, cu_seqlens_q, cu_seqlens_k, max_seqlen_q=None, max_seqlen_k=None,
                           dropout_p=0.0, softmax_scale=None, causal=False, **_ignored):
    """Packed `[total_tokens, heads, head_dim]` attention, one SDPA call per sequence."""
    import torch
    import torch.nn.functional as F

    if dropout_p:
        raise NotImplementedError("Le remplaçant de flash_attn ne gère pas le dropout.")
    cq, ck = cu_seqlens_q.tolist(), cu_seqlens_k.tolist()
    outs = []
    for i in range(len(cq) - 1):
        qi = q[cq[i]:cq[i + 1]].transpose(0, 1).unsqueeze(0)  # [1, heads, seq, head_dim]
        ki = k[ck[i]:ck[i + 1]].transpose(0, 1).unsqueeze(0)
        vi = v[ck[i]:ck[i + 1]].transpose(0, 1).unsqueeze(0)
        oi = F.scaled_dot_product_attention(qi, ki, vi, is_causal=causal, scale=softmax_scale)
        outs.append(oi.squeeze(0).transpose(0, 1))
    return torch.cat(outs, dim=0)


def flash_attn_func(*_args, **_kwargs):
    raise NotImplementedError("FlashAttention n'est pas installé (code du planificateur Bernini, inutilisé ici).")
