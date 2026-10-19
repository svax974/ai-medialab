# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

"""Update adviser: a small LOCAL language model reads public, structured sources about an update and lists the problems
people reported, so that the user knows what to look out for. The advice is informative: it never blocks anything.

What it reads (public pages only, read-only, nothing of the user's is sent anywhere):

- an ENGINE (stable-diffusion.cpp, audio.cpp, llama.cpp): GitHub, through the REST API: the notes of the releases between the
  installed build and the target, the open issues created since, and the commit titles between the two (`collect_engine`);
  plus the regressions this repository documents (`updates.KNOWN_REGRESSIONS`, which are never a guess);
- a MODEL (Hugging Face): for the files that changed, the title of the commit that last touched each, the open discussions of
  the repo with their first message, and the model card (the lines that changed since the revision in the cache,
  else its beginning) (`collect_model`).

The model only EXTRACTS, it knows nothing. Every source is numbered; the model must answer in JSON with, for each problem, the
source it comes from and an EXCERPT COPIED WORD FOR WORD. The code then keeps a finding only if its excerpt is found in the
source text it was given (after lowercasing and collapsing spaces and punctuation, `quote_in`): an invented or reworded
excerpt is dropped (`extract_findings`). The severity is the model's, capped by words that must appear in the excerpt itself
(`severity_cap`; a release note or a commit that says it FIXES something is never a defect), and the `verdict` is computed
from the kept findings and the known regressions, never given by the model (`verdict_of`). The summary is two or three
sentences the model writes from the kept findings only, or a plain template when it fails.

Budgets. GitHub allows 60 calls an hour without a token (checked on 2026-10-15 with `GET /rate_limit`: core 60, search 10 a
minute; with `GITHUB_TOKEN` 5 000): an analysis makes at most 4, so calls are counted per hour (`GithubClient`, 45 without a
token), answers are cached for an hour, and a refused or exhausted call only removes its source (a note says so). The
sources are cut to `SOURCE_CHARS_BUDGET` characters (about 10 000 tokens, with `llm.estimate_tokens`'s 3.5 characters per
token) so that, with the instructions and the answer, everything fits the 16 384 tokens of context: the known regressions
are never cut; then, in this order, the commits of the files that changed or the commits between builds, the release notes
(newest first, 3 500 characters each at most), the issues or discussions (newest first, 900 characters each), the card.
`truncated` counts what did not fit.

The model. `pick_model` takes the recommended adviser (`llm-qwen3-4b-instruct-2507`) when it is installed, else the strongest installed chat
model of at most `LIGHT_MODEL_GB` that can be made to think less, else the lightest of the rest; without any, `no_model` (409) and nothing is loaded.
The calls go through the engine's own chat manager (`llm.llm`: same memory arbitration as the chat, 16 384 tokens of context, reasoning off,
temperature 0.1, constrained JSON). After an analysis the model is NOT unloaded by hand: it stays for the keep-alive delay of the settings
(`llm.schedule_idle_unload`), so a batch of analyses loads it once, and a generation or a chat unloads it as usual.
"""

from __future__ import annotations

import asyncio
import difflib
import json
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from . import audiocpp, engine_install, llamacpp, runtime_settings, updates
from .engines import MODELS, get_spec, selected_variants
from .i18n import language
from .engines import resolve as resolve_variant

CONTEXT = 16384
SOURCE_CHARS_BUDGET = 36_000
RELEASES_MAX, RELEASE_CAP = 12, 3_500
ISSUES_MAX, ISSUE_CAP = 15, 900
COMMITS_MAX, COMMIT_LINE_CAP = 40, 160
DISCUSSIONS_MAX, DISCUSSION_CAP = 8, 900
README_DIFF_CAP, README_HEAD_CAP, README_MAX_BYTES = 4_000, 3_000, 300_000
MAX_FINDINGS, QUOTE_MIN, QUOTE_MAX, TITLE_MAX = 8, 12, 400, 120
GITHUB_CALLS_PER_HOUR, GITHUB_CALLS_WITH_TOKEN = 45, 4_500
CACHE_SECONDS = 3600
LLM_TIMEOUT_S = 240  # a typical analysis takes about a minute; this only ends one that hangs
PREFERRED_MODEL = "llm-qwen3-4b-instruct-2507"
LIGHT_MODEL_GB = 9.0  # above this a model is only used when nothing lighter is installed

ENGINE_REPOS = {"sdcpp": engine_install.REPO, "audiocpp": audiocpp.REPO, "llamacpp": llamacpp.REPO}
SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
# Whole words, on text `normalize` has reduced to words (so "doesn't" is "doesn t"): "room" is not "oom".
CRITICAL = re.compile(r"\b(regressions?|regressed|crash\w*|segfault\w*|segmentation fault|corrupt\w*|broken|data loss|out of memory|oom|"
                      r"hangs?|hanging|freez\w*|no longer works?|stopped working|fails? to|failed to|garbage output|(?:outputs?|produces?|generates?) garbage|"
                      r"black images?)\b")
WARNING = re.compile(r"\b(bugs?|errors?|issues?|problems?|slow\w*|deprecat\w*|breaking|incompatib\w*|workarounds?|not working|"
                     r"doesn t work|does not work|leaks?|unstable|mismatch\w*|wrong|different results?|artifacts?)\b")
FIX_WORDS = ("fix", "fixes", "fixed", "fixing", "resolve", "resolves", "resolved", "patch", "patched", "correct", "corrects", "address")
FIX_SOURCES = ("release", "commit", "card")  # these describe what was changed: a mention of a defect is a fix, not a defect


class AdvisorError(RuntimeError):
    """A refusal or a failure with the HTTP status the route answers (`code` lets the interface offer the right action)."""

    def __init__(self, code: str, message: str, status: int = 409) -> None:
        super().__init__(message)
        self.code, self.status = code, status


class RateLimited(RuntimeError):
    """GitHub refused the call (rate limit) or the hourly budget of this application is spent."""


@dataclass
class Source:
    id: str
    kind: str  # release | issue | commit | discussion | card
    title: str
    url: str
    text: str


@dataclass
class Collected:
    sources: list[Source] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# Quotes, severity, verdict ---------------------------------------------------------------------------------------------

def normalize(text: str) -> str:
    """Lowercase text with every run of spaces and punctuation reduced to one space (what an excerpt is compared on)."""
    return re.sub(r"[\W_]+", " ", unicodedata.normalize("NFKC", text).casefold()).strip()


def quote_in(quote: str, text: str) -> bool:
    """Whether `quote` is, after `normalize`, a stretch of `text` (long enough not to match anything by chance)."""
    q = normalize(quote)
    return len(q) >= QUOTE_MIN and q in normalize(text)


def severity_cap(kind: str, quote: str) -> str:
    """The highest severity the excerpt itself supports: `critical` words, else `warning` words, else `info`."""
    low = normalize(quote)
    if kind in FIX_SOURCES and any(w in FIX_WORDS for w in low.split()):
        return "info"
    if CRITICAL.search(low):
        return "critical"
    return "warning" if WARNING.search(low) else "info"


def verdict_of(findings: list[dict[str, Any]], known: list[dict[str, Any]]) -> str:
    """`discouraged` for a critical finding or a known regression, `caution` for a warning, else `none`."""
    if known or any(f["severity"] == "critical" for f in findings):
        return "discouraged"
    return "caution" if any(f["severity"] == "warning" for f in findings) else "none"


def _rank_min(a: str, b: str) -> str:
    return a if SEVERITY_RANK[a] <= SEVERITY_RANK[b] else b


def extract_findings(raw: str, sources: list[Source]) -> tuple[list[dict[str, Any]], int]:
    """(kept findings, rejected count) from the model's JSON answer; raises ValueError when it is not the expected JSON."""
    start, end = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[start:end + 1]) if 0 <= start < end else None
    items = data.get("findings") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("réponse du modèle : liste « findings » absente")
    by_id = {s.id: s for s in sources}
    kept: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        finding = _check_finding(item, by_id, sources)
        key = normalize(finding["quote"]) if finding else ""
        if finding and key not in seen and len(kept) < MAX_FINDINGS:
            seen.add(key)
            kept.append(finding)
    return kept, len(items) - len(kept)


def _check_finding(item: Any, by_id: dict[str, Source], sources: list[Source]) -> dict[str, Any] | None:
    if not isinstance(item, dict) or not isinstance(item.get("quote"), str) or not isinstance(item.get("title"), str):
        return None
    quote = " ".join(item["quote"].split())[:QUOTE_MAX]
    cited = by_id.get(str(item.get("source")))
    source = cited if cited and quote_in(quote, cited.text) else next((s for s in sources if quote_in(quote, s.text)), None)
    if source is None:  # invented, or reworded: it is not in what the model was given
        return None
    declared = item.get("severity") if item.get("severity") in SEVERITY_RANK else "info"
    return {"severity": _rank_min(declared, severity_cap(source.kind, quote)), "title": " ".join(item["title"].split())[:TITLE_MAX],
            "quote": quote, "url": source.url, "source_kind": source.kind}


# Sources: budget -------------------------------------------------------------------------------------------------------

def cut(text: str, cap: int) -> str:
    text = text.strip()
    return text if len(text) <= cap else text[:cap].rstrip() + " […]"


def fit_sources(sources: list[Source], budget: int = SOURCE_CHARS_BUDGET) -> tuple[list[Source], int]:
    """The sources, in priority order, that fit the character budget (the last one is cut to what is left); and how many did not."""
    kept: list[Source] = []
    left = budget
    for source in sources:
        room = left - len(source.title) - 40  # the heading of the block
        if room < 200:
            break
        text = cut(source.text, room)
        kept.append(Source(f"S{len(kept) + 1}", source.kind, source.title, source.url, text))
        left -= len(text) + len(source.title) + 40
    return kept, len(sources) - len(kept)


# GitHub ----------------------------------------------------------------------------------------------------------------

class GithubClient:
    """GitHub REST reads with an hourly budget and an hour of cache (a cached answer costs nothing)."""

    def __init__(self, fetch: Callable[[str], Any] = engine_install._http_json, now: Callable[[], float] = time.time,
                 limit: int | None = None) -> None:
        import os

        self.fetch, self.now = fetch, now
        self.limit = limit or (GITHUB_CALLS_WITH_TOKEN if os.environ.get("GITHUB_TOKEN") else GITHUB_CALLS_PER_HOUR)
        self._calls: deque[float] = deque()
        self._cache: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, path: str, ttl: float = CACHE_SECONDS) -> Any:
        """JSON of `https://api.github.com<path>`; None on 404; `RateLimited` when refused or when the budget is spent."""
        with self._lock:
            hit = self._cache.get(path)
            now = self.now()
            if hit and now - hit[0] < ttl:
                return hit[1]
            while self._calls and now - self._calls[0] > 3600:
                self._calls.popleft()
            if len(self._calls) >= self.limit:
                raise RateLimited("budget horaire d'appels à l'API GitHub atteint")
            self._calls.append(now)
        try:
            data = self.fetch(f"https://api.github.com{path}")
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429):
                raise RateLimited("limite de l'API GitHub atteinte") from None
            if exc.code == 404:
                return None
            raise
        with self._lock:
            self._cache[path] = (now, data)
        return data


def _first_lines(text: str | None, cap: int) -> str:
    return cut(re.sub(r"\r\n?", "\n", text or ""), cap)


def _published(release: dict[str, Any]) -> str:
    return str(release.get("published_at") or release.get("created_at") or "")


def releases_between(releases: list[dict[str, Any]], installed: str | None, target: str) -> list[dict[str, Any]]:
    """The releases after `installed` up to `target` included, newest first (only `target` when the installed one is unknown)."""
    order = updates_order
    out = []
    for r in releases:
        tag = r.get("tag_name")
        if tag == target or (installed and order(tag) is not None and order(target) is not None and order(installed) is not None
                             and order(installed) < order(tag) <= order(target)):
            out.append(r)
    return sorted(out, key=_published, reverse=True)[:RELEASES_MAX]


def updates_order(tag: str | None) -> tuple[int, ...] | None:
    """`updates._order` plus llama.cpp's `b11317`."""
    if (m := re.match(r"b(\d+)$", tag or "")):
        return (int(m.group(1)),)
    return updates._order(tag)


def collect_engine(engine_id: str, installed: str | None, target: str, gh: GithubClient) -> Collected:
    """GitHub sources for an engine update from `installed` to `target`."""
    repo, out = ENGINE_REPOS[engine_id], Collected()
    try:
        releases = releases_between(gh.get(f"/repos/{repo}/releases?per_page=100") or [], installed, target)
    except RateLimited as exc:
        return Collected(notes=[f"Notes de version non lues : {exc}."])
    first = _published(releases[-1]) if releases else ""
    commits = _commits_source(repo, installed, target, gh, out.notes)
    out.sources += ([commits] if commits else []) + [Source("", "release", f"Version {r['tag_name']}", r.get("html_url", ""),
                                                            _first_lines(r.get("body") or r.get("name"), RELEASE_CAP)) for r in releases]
    out.sources += _issue_sources(repo, first, gh, out.notes)
    return out


def _commits_source(repo: str, installed: str | None, target: str, gh: GithubClient, notes: list[str]) -> Source | None:
    if not installed or installed == target or installed == "?":
        return None
    try:
        data = gh.get(f"/repos/{repo}/compare/{installed}...{target}")
    except RateLimited as exc:
        notes.append(f"Commits non lus : {exc}.")
        return None
    commits = (data or {}).get("commits") or []
    lines = [cut(f"{c['sha'][:7]} {(c['commit']['message'] or '').splitlines()[0]}", COMMIT_LINE_CAP) for c in commits[::-1][:COMMITS_MAX]]
    if not lines:
        return None
    return Source("", "commit", f"Commits entre {installed} et {target}", (data or {}).get("html_url", ""), "\n".join(lines))


def _issue_sources(repo: str, since: str, gh: GithubClient, notes: list[str]) -> list[Source]:
    try:
        data = gh.get(f"/repos/{repo}/issues?state=open&sort=created&direction=desc&per_page=30") or []
    except RateLimited as exc:
        notes.append(f"Issues non lues : {exc}.")
        return []
    issues = [i for i in data if "pull_request" not in i and (not since or str(i.get("created_at") or "") >= since)]
    return [Source("", "issue", f"Issue #{i['number']} : {i['title']}", i.get("html_url", ""),
                   f"{i['title']}\n{_first_lines(i.get('body'), ISSUE_CAP)}") for i in issues[:ISSUES_MAX]]


# Hugging Face ----------------------------------------------------------------------------------------------------------

class HubClient:
    """The Hugging Face reads of the adviser (public pages, the user's token when there is one). Tests replace it."""

    def _api(self) -> Any:
        from huggingface_hub import HfApi

        return HfApi(token=runtime_settings.get_settings().get("hf_token") or None)

    def last_commits(self, repo: str, paths: list[str]) -> list[dict[str, str]]:
        """Title and date of the commit that last touched each file, without duplicates."""
        seen: dict[str, dict[str, str]] = {}
        for info in self._api().get_paths_info(repo, paths, expand=True):
            commit = getattr(info, "last_commit", None)
            if commit is not None and commit.oid not in seen:
                seen[commit.oid] = {"id": commit.oid[:7], "title": commit.title, "date": str(commit.date)[:10]}
        return sorted(seen.values(), key=lambda c: c["date"], reverse=True)

    def discussions(self, repo: str, limit: int) -> list[dict[str, str]]:
        """The open discussions (not pull requests), newest first, with the text of their first message."""
        api, out = self._api(), []
        for d in api.get_repo_discussions(repo, discussion_type="discussion", discussion_status="open"):
            if len(out) >= limit:
                break
            first = next((e.content for e in api.get_discussion_details(repo, d.num).events if e.type == "comment"), "")
            out.append({"num": str(d.num), "title": d.title, "date": str(d.created_at)[:10], "text": first or ""})
        return out

    def readme(self, repo: str, revision: str) -> str | None:
        req = urllib.request.Request(f"https://huggingface.co/{repo}/raw/{revision}/README.md", headers={"User-Agent": "ai-medialab"})
        if token := runtime_settings.get_settings().get("hf_token"):
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read(README_MAX_BYTES).decode("utf-8", errors="replace")
        except (urllib.error.URLError, OSError):
            return None


def readme_changes(old: str, new: str) -> str:
    """The lines of a card that were added or removed (a unified diff without its context)."""
    diff = difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=0)
    return "\n".join(line for line in diff if line[:1] in "+-" and line[:3] not in ("+++", "---") and line[1:].strip())


def collect_model(spec: Any, changed: dict[str, dict[str, str]], hub: HubClient) -> Collected:
    """Hub sources for the files of `spec` that changed (`changed`: repo -> {path: id of the file on the Hub})."""
    out = Collected()
    for repo, files in changed.items():
        for label, fetch in (("commits", lambda r=repo, f=files: _commit_source(hub, r, list(f))),
                             ("discussions", lambda r=repo: _discussion_sources(hub, r)), ("fiche", lambda r=repo: _card_source(hub, r))):
            try:
                out.sources += fetch()
            except Exception as exc:  # noqa: BLE001  a source that cannot be read must not hide the others
                out.notes.append(f"{label} de {repo} non lus ({type(exc).__name__}).")
    return out


def _commit_source(hub: HubClient, repo: str, paths: list[str]) -> list[Source]:
    commits = hub.last_commits(repo, paths[:100])
    if not commits:
        return []
    lines = [cut(f"{c['date']} {c['id']} {c['title']}", COMMIT_LINE_CAP) for c in commits[:COMMITS_MAX]]
    return [Source("", "commit", f"Derniers commits des fichiers modifiés ({repo})", f"https://huggingface.co/{repo}/commits/main", "\n".join(lines))]


def _discussion_sources(hub: HubClient, repo: str) -> list[Source]:
    return [Source("", "discussion", f"Discussion #{d['num']} : {d['title']}", f"https://huggingface.co/{repo}/discussions/{d['num']}",
                   f"{d['title']}\n{_first_lines(d['text'], DISCUSSION_CAP)}") for d in hub.discussions(repo, DISCUSSIONS_MAX)]


def _card_source(hub: HubClient, repo: str) -> list[Source]:
    new = hub.readme(repo, "main")
    if not new:
        return []
    from .engines.base import repo_cache_dir

    ref = repo_cache_dir(repo) / "refs" / "main"
    old = hub.readme(repo, ref.read_text().strip()) if ref.is_file() else None
    changes = readme_changes(old, new) if old else ""
    url = f"https://huggingface.co/{repo}"
    if changes:
        return [Source("", "card", f"Fiche du modèle, lignes modifiées ({repo})", url, cut(changes, README_DIFF_CAP))]
    return [Source("", "card", f"Fiche du modèle ({repo})", url, cut(new, README_HEAD_CAP))]


# The model --------------------------------------------------------------------------------------------------------------

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {"findings": {"type": "array", "maxItems": MAX_FINDINGS, "items": {
        "type": "object",
        "properties": {"source": {"type": "string", "maxLength": 8}, "title": {"type": "string", "maxLength": TITLE_MAX},
                       "quote": {"type": "string", "maxLength": QUOTE_MAX},
                       "severity": {"type": "string", "enum": ["info", "warning", "critical"]}},
        "required": ["source", "title", "quote", "severity"]}}},
    "required": ["findings"],
}
EXTRACT_SYSTEM = (
    "You read public notes, issues, discussions and commit titles about a new version of a software or of an AI model. "
    "List the PROBLEMS they report that could affect someone who installs it: regressions, crashes, broken features, "
    "incompatibilities, breaking changes, wrong results, memory problems. Ignore fixes, new features and improvements. "
    "Answer with JSON only: {\"findings\": [{\"source\": \"S3\", \"title\": short title, \"quote\": an excerpt COPIED WORD FOR "
    "WORD from that source, at most 300 characters, \"severity\": \"info\"|\"warning\"|\"critical\"}]}. Never write a quote that is "
    "not in the source; never invent anything. If there is no problem, answer {\"findings\": []}.")
SUMMARY_SYSTEM = {
    "fr": "Tu résumes en français, en deux ou trois phrases, les points ci-dessous qui concernent une mise à jour. Utilise UNIQUEMENT "
          "ces points, sans rien ajouter, sans conseil d'installation et sans certitude : ce sont des signalements à vérifier.",
    "en": "You summarise in English, in two or three sentences, the points below that concern an update. Use ONLY these points, "
          "add nothing, give no installation advice and no certainty: they are reports to check.",
}
EXTRACT_LANGUAGE = {"fr": " Write each \"title\" in French; keep each \"quote\" in its original language.",
                    "en": " Write each \"title\" in English; keep each \"quote\" in its original language."}

Llm = Callable[..., Awaitable[str]]


def render_sources(sources: list[Source], heading: str) -> str:
    blocks = [f"[{s.id}] ({s.kind}) {s.title}\n{s.text}" for s in sources]
    return f"{heading}\n\n" + "\n\n".join(blocks)


def template_summary(findings: list[dict[str, Any]], known: list[dict[str, Any]], consulted: int) -> str:
    """The summary when the model cannot write one (or there is nothing to summarise)."""
    points = [f["title"] for f in [*known, *findings]]
    if not points:
        return f"Aucun problème signalé dans les {consulted} source(s) consultée(s)."
    return f"Points signalés : {' ; '.join(points[:4]) + ('…' if len(points) > 4 else '.')}"


def pick_model() -> Any | None:
    """The chat model the adviser uses: the recommended one when it is installed, else the strongest installed one that stays
    light (`LIGHT_MODEL_GB`) and can think less (no `always` reasoning), else the lightest of the others; None without any."""
    from .downloads import downloads

    downloads.invalidate()
    installed = [s for s in (get_spec(m.id) for m in MODELS.values() if m.kind == "llm") if downloads.status(s)["state"] == "installed"]
    if not installed:
        return None
    first = next((s for s in installed if s.id == PREFERRED_MODEL), None)
    if first:
        return first
    usable = [s for s in installed if s.llm and s.llm.context_max >= CONTEXT and s.llm.reasoning != "always"] or installed
    light = [s for s in usable if (s.weights_gb or 0) <= LIGHT_MODEL_GB]
    return max(light, key=lambda s: (s.llm.params_b or s.weights_gb or 0) if s.llm else 0) if light \
        else min(usable, key=lambda s: s.weights_gb or 0)


async def run_llm(spec: Any, messages: list[dict[str, str]], *, max_tokens: int, response_format: dict[str, Any] | None = None,
                  temperature: float = 0.1) -> str:
    """One chat completion by the engine's own chat manager (the same memory arbitration as the chat), whole text."""
    from .llm import LlmError, llm

    request: dict[str, Any] = {"model_id": spec.id, "messages": messages, "reasoning": "off", "context_size": CONTEXT,
                               "params": {"temperature": temperature, "max_tokens": max_tokens, "seed": 7}}
    if response_format:
        request["response_format"] = response_format
    try:
        chosen = llm.precheck(spec.id, CONTEXT)
        events = llm.chat(chosen, request, llm.prepare(chosen, request))
        text, failure = "", None
        try:
            async for event in events:
                if event["type"] == "delta":
                    text += event["content"]
                elif event["type"] == "error":
                    failure = event
                    break
        finally:
            await events.aclose()  # releases the chat manager (`_chatting`) even when the loop stopped early
        if failure:
            raise AdvisorError("busy" if failure.get("code") == "busy" else "llm", str(failure["message"]),
                               409 if failure.get("code") == "busy" else 502)
        return text
    except LlmError as exc:
        raise AdvisorError("busy" if exc.status == 409 else "llm", str(exc), exc.status) from None


# The analysis -----------------------------------------------------------------------------------------------------------

def _row_of(kind: str, item_id: str, target: str) -> dict[str, Any]:
    """The check row of the item and the versions an analysis is about; the refusals the route answers."""
    if kind == "engine":
        row = next((r for r in updates.check_engines(upstream=_latest_tag) if r["id"] == item_id), None)
        if row is None:
            raise AdvisorError("not_installed", "Ce moteur n'est pas installé.", 404)
        if item_id not in ENGINE_REPOS:
            raise AdvisorError("unsupported", "Pas d'analyse pour ce composant (aucun dépôt public à lire).")
        to = (row["latest"] or {}).get("tag") if target == "latest" else row["target"]
        if not to or (target == "pinned" and row["state"] != "update"):
            raise AdvisorError("nothing_to_analyse", "Aucune mise à jour à analyser pour ce moteur.")
        return {**row, "from": None if row["installed"] in (None, "?") else row["installed"], "to": to}
    rows = updates.check_models(only=item_id)
    if not rows or rows[0]["state"] != "update":
        raise AdvisorError("nothing_to_analyse", "Aucune mise à jour à analyser pour ce modèle.")
    return {**rows[0], "from": rows[0].get("revision"), "to": rows[0].get("fingerprint")}


_github = GithubClient()


def _latest_tag(repo: str) -> str | None:
    """`updates.latest_tag` through the adviser's cache (an analysis right after a check costs no extra call)."""
    try:
        data = _github.get(f"/repos/{repo}/releases/latest", ttl=60)
        return str(data["tag_name"]) if data else None
    except Exception:  # noqa: BLE001  informational only
        return None


def _changed_files(spec: Any) -> dict[str, dict[str, str]]:
    """repo -> {path: id on the Hub} of the files of `spec` that changed since they were downloaded."""
    out: dict[str, dict[str, str]] = {}
    for src in spec.all_sources():
        remote = updates.remote_files(src.repo)
        diff = updates.diff_source(src, remote, updates.local_files(src.repo))
        if diff.changed:
            out.setdefault(src.repo, {}).update({p: remote[p][0] for p in diff.changed})
    return out


async def advise(kind: str, item_id: str, target: str = "pinned", *, llm_call: Llm = run_llm, hub: HubClient | None = None,
                 github: GithubClient | None = None, model: Any | None = None) -> dict[str, Any]:
    """The advice about one update (see the module docstring). Raises `AdvisorError`; nothing is stored here."""
    row = await asyncio.to_thread(_row_of, kind, item_id, target)
    if model is None and llamacpp.installed_binary() is None:
        raise AdvisorError("no_engine", "Le moteur de chat (llama.cpp) n'est pas installé : installez-le pour analyser les risques.")
    spec = model or pick_model()
    if spec is None:
        raise AdvisorError("no_model", "Aucun modèle de chat n'est installé : installez-en un (le conseiller recommandé fait 2,3 Go).")
    gather = _gather_engine if kind == "engine" else _gather_model
    collected, known = await asyncio.to_thread(gather, row, item_id, github or _github, hub or HubClient())
    if not collected.sources and not known:
        raise AdvisorError("no_sources", "Impossible de lire les sources (réseau ou limite de l'API GitHub) : réessayez plus tard.", 502)
    sources, dropped = fit_sources(collected.sources)
    findings, rejected = await _extract(sources, spec, llm_call, row, kind)
    summary = await _summarise(findings, known, len(sources), spec, llm_call)
    return {"kind": kind, "id": item_id, "target": target, "from_version": row["from"], "to_version": row["to"],
            "verdict": verdict_of(findings, known), "summary": summary,
            "findings": [*known, *findings], "sources": [{"title": s.title, "url": s.url} for s in sources if s.url],
            "notes": collected.notes, "truncated": dropped, "rejected": rejected, "llm_model_id": spec.id,
            "generated_at": time.time()}


def _gather_engine(row: dict[str, Any], item_id: str, gh: GithubClient, _hub: HubClient) -> tuple[Collected, list[dict[str, Any]]]:
    known = [{"severity": "critical", "title": r["effect"], "quote": r["effect"], "url": "", "source_kind": "known"}
             for r in updates.regressions_for(item_id, row["to"])]
    return collect_engine(item_id, row["from"], row["to"], gh), known


def _gather_model(row: dict[str, Any], item_id: str, _gh: GithubClient, hub: HubClient) -> tuple[Collected, list[dict[str, Any]]]:
    spec = resolve_variant(MODELS[item_id], selected_variants())
    return collect_model(spec, _changed_files(spec), hub), []


async def _extract(sources: list[Source], spec: Any, llm_call: Llm, row: dict[str, Any], kind: str) -> tuple[list[dict[str, Any]], int]:
    if not sources:
        return [], 0
    what = f"{row['name']}, de {row['from'] or 'la version installée'} à {row['to']}" if kind == "engine" else row["name"]
    messages = [{"role": "system", "content": EXTRACT_SYSTEM + EXTRACT_LANGUAGE[language()]},
                {"role": "user", "content": render_sources(sources, f"Update of {what}.")}]
    try:
        raw = await asyncio.wait_for(llm_call(spec, messages, max_tokens=1400,
                                              response_format={"type": "json_schema", "schema": EXTRACT_SCHEMA}), LLM_TIMEOUT_S)
        return extract_findings(raw, sources)
    except asyncio.TimeoutError:
        raise AdvisorError("llm", "L'analyse a pris trop de temps : abandon.", 504) from None
    except (ValueError, KeyError):
        raise AdvisorError("llm_output", "Le modèle n'a pas rendu de réponse exploitable : réessayez, ou choisissez un modèle plus capable.", 502) from None


async def _summarise(findings: list[dict[str, Any]], known: list[dict[str, Any]], consulted: int, spec: Any, llm_call: Llm) -> str:
    points = [*known, *findings]
    if not points:
        return template_summary([], [], consulted)
    text = "\n".join(f"- {p['title']} : « {p['quote']} »" for p in points)
    try:
        said = await asyncio.wait_for(llm_call(spec, [{"role": "system", "content": SUMMARY_SYSTEM[language()]}, {"role": "user", "content": text}],
                                               max_tokens=220, temperature=0.2), LLM_TIMEOUT_S)
        return " ".join(said.split()) or template_summary(findings, known, consulted)
    except (AdvisorError, asyncio.TimeoutError):
        return template_summary(findings, known, consulted)
