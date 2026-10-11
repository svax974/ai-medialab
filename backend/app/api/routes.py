"""Routes REST + flux d'événements."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import db, repo
from ..catalog import describe_models
from ..downloads import downloads
from ..engine_install import installer
from ..engines import MODELS, get_spec
from ..events import bus
from ..jobs import jobs, load_settings, new_seed
from ..media import make_thumb, save_upload
from ..system import get_system
from ..config import UPLOADS_DIR

router = APIRouter(prefix="/api")

MAX_COUNT = 4


# --- Modèles, moteur, réglages --------------------------------------------------------------------

@router.get("/models")
def list_models() -> dict[str, Any]:
    return describe_models()


@router.get("/system")
def system_info(refresh: bool = False) -> dict[str, Any]:
    info = get_system(refresh=refresh)
    engines = {k: dict(v) for k, v in info["engines"].items()}
    engines["sdcpp"]["install"] = installer.public()  # état en direct, hors du cache de détection
    return {**info, "engines": engines}


@router.post("/engines/sdcpp/install")
async def install_engine() -> dict[str, Any]:
    try:
        return await installer.start()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from None


@router.delete("/engines/sdcpp/install")
async def cancel_engine_install() -> dict[str, Any]:
    if not installer.cancel():
        raise HTTPException(409, "Aucune installation en cours.")
    return {"ok": True}


@router.post("/models/{model_id}/download")
async def download_model(model_id: str) -> dict[str, Any]:
    try:
        job = await downloads.start(model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(409, str(exc)) from None
    return job.public()


@router.delete("/models/{model_id}/download")
async def cancel_download(model_id: str) -> dict[str, Any]:
    if not await downloads.cancel(model_id):
        raise HTTPException(409, "Aucun téléchargement en cours pour ce modèle.")
    return {"ok": True}


@router.delete("/models/{model_id}")
async def delete_model(model_id: str) -> dict[str, Any]:
    if jobs.worker and jobs.worker.model_id == model_id:
        raise HTTPException(409, "Ce modèle est chargé en mémoire : déchargez-le d'abord.")
    try:
        return downloads.delete(model_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(409, str(exc)) from None


@router.get("/status")
def engine_status() -> dict[str, Any]:
    return jobs.status()


@router.post("/engine/unload")
async def unload_engine() -> dict[str, Any]:
    if jobs.current:
        raise HTTPException(409, "Une génération est en cours.")
    await jobs.unload()
    return jobs.status()


class SettingsPatch(BaseModel):
    keep_alive_minutes: int | None = None
    previews: bool | None = None
    low_memory: bool | None = None
    hf_token: str | None = None
    quantize: dict[str, int | None] | None = None


def _public_settings() -> dict[str, Any]:
    st = load_settings()
    token = st.pop("hf_token", None)
    st["has_hf_token"] = bool(token)
    return st


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return _public_settings()


@router.put("/settings")
def put_settings(patch: SettingsPatch) -> dict[str, Any]:
    values = patch.model_dump(exclude_none=True)
    if "quantize" in values:
        merged = {**load_settings()["quantize"], **patch.quantize}
        for model_id, bits in merged.items():
            if model_id in MODELS and bits is not None and bits not in MODELS[model_id].quantize_options:
                raise HTTPException(422, f"Quantification {bits} non prise en charge par {model_id}.")
        values["quantize"] = merged
    if "hf_token" in values:
        values["hf_token"] = values["hf_token"].strip()
    db.put_settings(values)
    return _public_settings()


# --- Conversations ---------------------------------------------------------------------------------

@router.get("/conversations")
def list_conversations(q: str | None = None) -> list[dict[str, Any]]:
    return repo.list_conversations(q.strip() if q else None)


class ConversationCreate(BaseModel):
    title: str = "Nouvelle création"


@router.post("/conversations")
def create_conversation(body: ConversationCreate) -> dict[str, Any]:
    cid = db.new_id()
    ts = db.now()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (cid, body.title.strip() or "Nouvelle création", ts, ts),
        )
    conv = repo.get_conversation(cid)
    bus.publish("conversation.updated", _summary(cid))
    return conv


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> dict[str, Any]:
    conv = repo.get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation introuvable.")
    return conv


class ConversationPatch(BaseModel):
    title: str | None = None
    pinned: bool | None = None


@router.patch("/conversations/{conversation_id}")
def patch_conversation(conversation_id: str, body: ConversationPatch) -> dict[str, Any]:
    with db.connect() as conn:
        if body.title is not None:
            conn.execute("UPDATE conversations SET title = ? WHERE id = ?", (body.title.strip()[:200], conversation_id))
        if body.pinned is not None:
            conn.execute("UPDATE conversations SET pinned = ? WHERE id = ?", (int(body.pinned), conversation_id))
    summary = _summary(conversation_id)
    if not summary:
        raise HTTPException(404, "Conversation introuvable.")
    bus.publish("conversation.updated", summary)
    return summary


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str) -> dict[str, Any]:
    with db.connect() as conn:
        busy = conn.execute(
            "SELECT id FROM messages WHERE conversation_id = ? AND status IN ('queued','loading','running')",
            (conversation_id,),
        ).fetchall()
    for row in busy:
        await jobs.cancel(row["id"])
    with db.connect() as conn:
        assets = conn.execute(
            "SELECT * FROM assets WHERE conversation_id = ? OR message_id IN "
            "(SELECT id FROM messages WHERE conversation_id = ?)",
            (conversation_id, conversation_id),
        ).fetchall()
        conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        repo.purge_assets(conn, assets)
    bus.publish("conversation.deleted", {"id": conversation_id})
    return {"ok": True}


def _summary(conversation_id: str) -> dict[str, Any] | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        return repo.conversation_summary(conn, row) if row else None


# --- Messages / générations ------------------------------------------------------------------------

class MessageCreate(BaseModel):
    conversation_id: str | None = None
    prompt: str = Field(min_length=1, max_length=8000)
    model_id: str
    params: dict[str, Any] = Field(default_factory=dict)
    reference_ids: list[str] = Field(default_factory=list)
    count: int = Field(default=1, ge=1, le=MAX_COUNT)


def _seeds(params: dict[str, Any], count: int) -> list[int]:
    seed = params.get("seed")
    if seed is not None and str(seed).strip() != "":
        base = int(seed)
        return [base + i for i in range(count)]
    return [new_seed() for _ in range(count)]


def _title_from_prompt(prompt: str) -> str:
    text = " ".join(prompt.split())
    return text if len(text) <= 60 else text[:57].rsplit(" ", 1)[0] + "…"


@router.post("/messages")
def create_message(body: MessageCreate) -> dict[str, Any]:
    try:
        spec = get_spec(body.model_id)
    except KeyError as exc:
        raise HTTPException(422, str(exc)) from None
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(422, "Le prompt est vide.")
    if spec.requires_references and not body.reference_ids:
        raise HTTPException(422, f"{spec.name} a besoin d'au moins une image de référence.")

    ts = db.now()
    with db.connect() as conn:
        cid = body.conversation_id
        if cid:
            if not conn.execute("SELECT 1 FROM conversations WHERE id = ?", (cid,)).fetchone():
                raise HTTPException(404, "Conversation introuvable.")
        else:
            cid = db.new_id()
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (cid, _title_from_prompt(prompt), ts, ts),
            )
        # Première génération d'une conversation créée vide : on la titre d'après le prompt.
        has_msgs = conn.execute("SELECT 1 FROM messages WHERE conversation_id = ? LIMIT 1", (cid,)).fetchone()
        if not has_msgs:
            conn.execute(
                "UPDATE conversations SET title = ? WHERE id = ? AND title = 'Nouvelle création'",
                (_title_from_prompt(prompt), cid),
            )

        user_id = db.new_id()
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, prompt, created_at) VALUES (?, ?, 'user', ?, ?)",
            (user_id, cid, prompt, ts),
        )
        for pos, asset_id in enumerate(dict.fromkeys(body.reference_ids)):
            asset = conn.execute("SELECT id, conversation_id FROM assets WHERE id = ?", (asset_id,)).fetchone()
            if not asset:
                raise HTTPException(422, f"Image de référence introuvable : {asset_id}")
            conn.execute("INSERT INTO message_refs (message_id, asset_id, position) VALUES (?, ?, ?)",
                         (user_id, asset_id, pos))
            if asset["conversation_id"] is None:
                conn.execute("UPDATE assets SET conversation_id = ? WHERE id = ?", (cid, asset_id))

        params = {**spec.default_params(), **body.params, "count": body.count}
        params["seeds"] = _seeds(params, body.count)
        assistant_id = _insert_assistant(conn, cid, user_id, prompt, spec.id, params)
        repo.touch_conversation(conn, cid)

    jobs.enqueue(assistant_id)
    user_msg, assistant_msg = repo.get_message(user_id), repo.get_message(assistant_id)
    bus.publish("conversation.updated", _summary(cid))
    return {"conversation_id": cid, "user_message": user_msg, "assistant_message": assistant_msg}


def _insert_assistant(conn, cid: str, parent_id: str, prompt: str, model_id: str, params: dict) -> str:
    mid = db.new_id()
    conn.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, role, prompt, model_id, params, status, created_at) "
        "VALUES (?, ?, ?, 'assistant', ?, ?, ?, 'queued', ?)",
        (mid, cid, parent_id, prompt, model_id, json.dumps(params), db.now()),
    )
    return mid


class RetryBody(BaseModel):
    model_id: str | None = None
    params: dict[str, Any] | None = None
    keep_seed: bool = False


@router.post("/messages/{message_id}/retry")
def retry_message(message_id: str, body: RetryBody) -> dict[str, Any]:
    msg = repo.get_message(message_id)
    if not msg or msg["role"] != "assistant":
        raise HTTPException(404, "Génération introuvable.")
    params = {**msg["params"], **(body.params or {})}
    count = int(params.get("count") or 1)
    if not body.keep_seed:
        params["seed"] = None
    params["seeds"] = msg["params"].get("seeds") if body.keep_seed else _seeds(params, count)
    model_id = body.model_id or msg["model_id"]
    get_spec(model_id)
    with db.connect() as conn:
        mid = _insert_assistant(conn, msg["conversation_id"], msg["parent_id"], msg["prompt"], model_id, params)
        repo.touch_conversation(conn, msg["conversation_id"])
    jobs.enqueue(mid)
    new_msg = repo.get_message(mid)
    bus.publish("message.updated", new_msg)
    return new_msg


@router.post("/messages/{message_id}/cancel")
async def cancel_message(message_id: str) -> dict[str, Any]:
    ok = await jobs.cancel(message_id)
    if not ok:
        raise HTTPException(409, "Cette génération n'est plus en cours.")
    return {"ok": True}


@router.delete("/messages/{message_id}")
async def delete_message(message_id: str) -> dict[str, Any]:
    msg = repo.get_message(message_id)
    if not msg:
        raise HTTPException(404, "Message introuvable.")
    with db.connect() as conn:
        if msg["role"] == "user":
            ids = [message_id] + [r["id"] for r in conn.execute(
                "SELECT id FROM messages WHERE parent_id = ?", (message_id,)).fetchall()]
        else:
            ids = [message_id]
    for mid in ids:
        if mid == jobs.current or mid in jobs.pending:
            await jobs.cancel(mid)
    with db.connect() as conn:
        marks = ",".join("?" * len(ids))
        assets = conn.execute(
            f"SELECT * FROM assets WHERE message_id IN ({marks}) OR (kind = 'upload' AND id IN "
            f"(SELECT asset_id FROM message_refs WHERE message_id IN ({marks})))",
            (*ids, *ids),
        ).fetchall()
        conn.execute(f"DELETE FROM messages WHERE id IN ({marks})", ids)
        repo.purge_assets(conn, assets)
    bus.publish("message.deleted", {"conversation_id": msg["conversation_id"], "ids": ids})
    bus.publish("conversation.updated", _summary(msg["conversation_id"]))
    return {"ok": True, "deleted": ids}


# --- Images ----------------------------------------------------------------------------------------

@router.post("/assets")
async def upload_assets(files: list[UploadFile] = File(...)) -> list[dict[str, Any]]:
    created = []
    for f in files:
        data = await f.read()
        asset_id = db.new_id()
        try:
            filename, w, h = await asyncio.to_thread(save_upload, asset_id, data)
        except Exception:
            raise HTTPException(422, f"Image illisible : {f.filename}") from None
        thumb = await asyncio.to_thread(make_thumb, UPLOADS_DIR / filename, asset_id)
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO assets (id, kind, filename, thumb, original_name, width, height, created_at) "
                "VALUES (?, 'upload', ?, ?, ?, ?, ?, ?)",
                (asset_id, filename, thumb, f.filename, w, h, db.now()),
            )
            row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        created.append(repo.asset_public(row))
    return created


@router.get("/assets")
def list_assets(
    kind: str = "generated",
    favorites: bool = False,
    q: str | None = None,
    before: float | None = None,
    limit: int = 60,
) -> dict[str, Any]:
    sql = (
        "SELECT a.*, c.title AS conversation_title, m.prompt AS prompt, m.model_id AS model_id "
        "FROM assets a LEFT JOIN conversations c ON c.id = a.conversation_id "
        "LEFT JOIN messages m ON m.id = a.message_id WHERE a.kind = ?"
    )
    args: list[Any] = [kind]
    if favorites:
        sql += " AND a.favorite = 1"
    if q:
        sql += " AND (m.prompt LIKE ? OR c.title LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    if before:
        sql += " AND a.created_at < ?"
        args.append(before)
    sql += " ORDER BY a.created_at DESC LIMIT ?"
    args.append(max(1, min(200, limit)))
    with db.connect() as conn:
        rows = conn.execute(sql, args).fetchall()
    items = []
    for r in rows:
        a = repo.asset_public(r)
        a.update(conversation_title=r["conversation_title"], prompt=r["prompt"], model_id=r["model_id"])
        items.append(a)
    return {"items": items, "next_before": items[-1]["created_at"] if len(items) == limit else None}


class AssetPatch(BaseModel):
    favorite: bool | None = None


@router.patch("/assets/{asset_id}")
def patch_asset(asset_id: str, body: AssetPatch) -> dict[str, Any]:
    with db.connect() as conn:
        if body.favorite is not None:
            conn.execute("UPDATE assets SET favorite = ? WHERE id = ?", (int(body.favorite), asset_id))
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Image introuvable.")
    asset = repo.asset_public(row)
    bus.publish("asset.updated", asset)
    return asset


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: str) -> dict[str, Any]:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Image introuvable.")
        conn.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
        repo.delete_asset_files(row)
    bus.publish("asset.deleted", {"id": asset_id, "message_id": row["message_id"],
                                  "conversation_id": row["conversation_id"]})
    return {"ok": True}


# --- Temps réel ------------------------------------------------------------------------------------

@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    q = bus.subscribe()

    async def stream():
        try:
            yield "retry: 2000\n\n"
            yield f"event: engine.status\ndata: {json.dumps(jobs.status())}\n\n"
            for prog in jobs.snapshot():
                yield f"event: job.progress\ndata: {json.dumps(prog)}\n\n"
            for dl in downloads.active():
                yield f"event: download.progress\ndata: {json.dumps(dl)}\n\n"
            yield f"event: engine.install\ndata: {json.dumps(installer.public())}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            bus.unsubscribe(q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
