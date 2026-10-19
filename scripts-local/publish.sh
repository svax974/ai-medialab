#!/usr/bin/env bash
# Copyright (c) 2026 Stéphane Vaxelaire
# SPDX-License-Identifier: MIT

# Builds the desktop packages of every platform and publishes them as a GitHub release.
#
#   scripts-local/publish.sh                          this Mac + Windows, release v<project version>, pre-release
#   scripts-local/publish.sh --targets darwin-arm64,win-x64,linux-x64
#   scripts-local/publish.sh --version 0.2.0 --stable
#   scripts-local/publish.sh --skip-build             upload what desktop/dist already holds for that version
#   scripts-local/publish.sh --no-upload              build only (nothing is sent to GitHub)
#   scripts-local/publish.sh --dry-run                print the plan, build and send nothing
#
# Options: --targets <list> (default: host + win-x64), --version <x.y.z> (default: project.config.json, else
# back/package.json), --stable (default: pre-release), --notes <file> (extra release notes), --allow-dirty,
# --skip-build, --no-upload, --dry-run.
#
# Steps per target (what scripts/bundle.sh does, with two additions): the prepare hook builds the engine runtime
# without the sd.cpp variants the app downloads itself (DESKTOP_SKIP_SDCPP_VARIANTS); the production node_modules of
# the back lose the dependencies no code uses (PRUNE_NPM). Then: macOS .dmg via tauri; Windows .zip / Linux .tar.gz
# via scripts/desktop/package-cross.mjs. A file over GitHub's 2 GiB asset limit is cut into parts
# (<name>.part-aa, .part-ab…, rebuilt with `cat`). The release is created as a draft, filled, then published.
#
# Every heavy step runs under docs/migration/tools/guarded_run.sh (memory guard, GUARD_GB, default 5).
# Needs: gh (logged in), node, cargo, uv; Windows from a Mac: mingw-w64 + zip; Linux: running Docker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"
# shellcheck source=../scripts/desktop/common.sh
source "${PROJECT_ROOT}/scripts/desktop/common.sh"

GUARD="${PROJECT_ROOT}/docs/migration/tools/guarded_run.sh"
GUARD_GB="${GUARD_GB:-5}"
PART_SIZE="${PART_SIZE:-1900m}"            # under GitHub's 2 GiB asset limit
PRUNE_NPM=(@base-org/account stripe typescript)   # in back dependencies (template base), imported by no code
export DESKTOP_SKIP_SDCPP_VARIANTS="${DESKTOP_SKIP_SDCPP_VARIANTS:-cuda,rocm}"   # downloaded by the app at first launch

DIST="${PROJECT_ROOT}/desktop/dist"
HOST="$(host_target)"

# --- internal entry point: one target, run under the memory guard --------------------------------------------------
if [[ "${1:-}" == "__build_target" ]]; then
  TARGET="$2"; VERSION="$3"
  build_target() {
    local out; out="$(resources_dir "${TARGET}")"
    run_prepare_hook "${TARGET}"
    assemble "${TARGET}" --version "${VERSION}"
    prune_back_modules "${out}" "${TARGET}"
    if [[ "${TARGET}" == "${HOST}" ]]; then
      local bundle_dir; bundle_dir="$(release_dir)/bundle"
      find "${bundle_dir}" -maxdepth 2 \( -name '*.dmg' -o -name '*.deb' -o -name '*.AppImage' -o -name '*-setup.exe' \) -delete 2>/dev/null || true
      node "${DESKTOP_SCRIPTS}/build-desktop.mjs" --root "${PROJECT_ROOT}" --target "${TARGET}" --out "${out}" \
        --skip-install --version "${VERSION}" --bundle
      collect_host "${bundle_dir}"
    else
      node "${DESKTOP_SCRIPTS}/package-cross.mjs" --root "${PROJECT_ROOT}" --target "${TARGET}" --resources "${out}" \
        --out "${DIST}" --version "${VERSION}"
    fi
  }

  # Removes the unused production dependencies from the assembled back, then checks nothing still needs them.
  prune_back_modules() {
    local out="$1" target="$2" cross=()
    case "${target}" in
      win-x64) cross=(--os=win32 --cpu=x64) ;;
      linux-x64) cross=(--os=linux --cpu=x64) ;;
    esac
    local before after; before="$(du -sm "${out}/back/node_modules" | cut -f1)"
    (cd "${out}/back" && npm uninstall "${PRUNE_NPM[@]}" --omit=dev --ignore-scripts --no-audit --no-fund ${cross[@]+"${cross[@]}"})
    after="$(du -sm "${out}/back/node_modules" | cut -f1)"
    info "back/node_modules: ${before} Mo → ${after} Mo"
    local pkg
    for pkg in "${PRUNE_NPM[@]}"; do
      if grep -rqE "require\(['\"]${pkg}[/'\"]" "${out}/back/dist"; then err "back/dist still requires ${pkg}"; return 1; fi
    done
    [[ -f "${out}/back/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]] || { err "better-sqlite3 binary lost by the prune"; return 1; }
  }

  collect_host() {
    local bundle_dir="$1" found=0 f
    shopt -s nullglob
    for f in "${bundle_dir}"/dmg/*.dmg "${bundle_dir}"/deb/*.deb "${bundle_dir}"/appimage/*.AppImage "${bundle_dir}"/nsis/*.exe; do
      cp -f "${f}" "${DIST}/"; found=1
    done
    shopt -u nullglob
    [[ ${found} -eq 1 ]] || { err "tauri build produced no installer in ${bundle_dir}"; return 1; }
  }
  build_target
  exit 0
fi

# --- arguments -----------------------------------------------------------------------------------------------------
TARGETS=""; VERSION=""; PRERELEASE=1; NOTES_FILE=""; ALLOW_DIRTY=0; SKIP_BUILD=0; UPLOAD=1; DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --targets) TARGETS="${2:?--targets needs a comma-separated list}"; shift 2 ;;
    --version) VERSION="${2:?--version needs x.y.z}"; shift 2 ;;
    --stable) PRERELEASE=0; shift ;;
    --notes) NOTES_FILE="${2:?--notes needs a file}"; shift 2 ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-upload) UPLOAD=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '5,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'; exit 0 ;;
    *) err "Unknown option: $1"; exit 2 ;;
  esac
done

if [[ -z "${VERSION}" ]]; then
  VERSION="$(node -e "const f=require('fs'); let v; try { v = JSON.parse(f.readFileSync('project.config.json','utf8')).version } catch {} ; console.log(v ?? JSON.parse(f.readFileSync('back/package.json','utf8')).version)")"
fi
[[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || { err "Invalid version: ${VERSION}"; exit 2; }
TAG="v${VERSION}"
[[ -n "${TARGETS}" ]] || TARGETS="${HOST},win-x64"
PRODUCT="$(desktop_field 'c.productName')"
REPO="$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"

info "${PRODUCT} ${TAG} → ${REPO} ($([[ ${PRERELEASE} -eq 1 ]] && echo pre-release || echo stable)); targets: ${TARGETS}"
info "sd.cpp variants left to the first-launch download: ${DESKTOP_SKIP_SDCPP_VARIANTS}; pruned npm packages: ${PRUNE_NPM[*]}"
if [[ ${DRY_RUN} -eq 1 ]]; then
  ok "Dry run: nothing built, nothing sent."; exit 0
fi

# --- preconditions -------------------------------------------------------------------------------------------------
if [[ ${UPLOAD} -eq 1 ]]; then
  command -v gh >/dev/null || { err "gh not found"; exit 1; }
  gh auth status >/dev/null 2>&1 || { err "gh is not logged in (gh auth login)"; exit 1; }
  if gh release view "${TAG}" --repo "${REPO}" >/dev/null 2>&1; then err "Release ${TAG} already exists on ${REPO}"; exit 1; fi
  git fetch --quiet origin
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse '@{upstream}' 2>/dev/null || echo none)" ]]; then
    err "HEAD is not on its upstream branch: push first (the release tag is created on the remote)"; exit 1
  fi
fi
if [[ ${ALLOW_DIRTY} -eq 0 ]] && [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  err "Uncommitted changes: commit them, or pass --allow-dirty (the release would not match the tag)"; exit 1
fi
[[ -x "${GUARD}" ]] || { err "${GUARD} missing or not executable"; exit 1; }

mkdir -p "${DIST}" desktop/build
RUN_STAMP="$(mktemp "${PROJECT_ROOT}/desktop/build/.publish-run.XXXXXX")"
trap 'rm -f "${RUN_STAMP}"' EXIT

# --- build ---------------------------------------------------------------------------------------------------------
if [[ ${SKIP_BUILD} -eq 0 ]]; then
  "${GUARD}" "${GUARD_GB}" bash -c "cd '${PROJECT_ROOT}' && source scripts/desktop/common.sh && desktop_check_project && build_web"
  FAILED=()
  IFS=',' read -r -a LIST <<< "${TARGETS}"
  for t in "${LIST[@]}"; do
    info "=== ${t} ==="
    if "${GUARD}" "${GUARD_GB}" "${BASH_SOURCE[0]}" __build_target "${t}" "${VERSION}"; then ok "${t} built"; else err "${t} failed"; FAILED+=("${t}"); fi
  done
  [[ ${#FAILED[@]} -eq 0 ]] || { err "Failed: ${FAILED[*]} (no release created)"; exit 1; }
fi

# --- assets: this run's packages (or, with --skip-build, those of that version), cut under the size limit ----------
ASSETS=()
while IFS= read -r f; do ASSETS+=("${f}"); done < <(
  if [[ ${SKIP_BUILD} -eq 1 ]]; then find "${DIST}" -maxdepth 1 -type f -name "*${VERSION}*"
  else find "${DIST}" -maxdepth 1 -type f -newer "${RUN_STAMP}"; fi | sort)
[[ ${#ASSETS[@]} -gt 0 ]] || { err "No package for ${VERSION} in ${DIST}"; exit 1; }

UPLOADS=(); NOTES_FILES=""
LIMIT=$((2 * 1024 * 1024 * 1024 - 1))
for f in "${ASSETS[@]}"; do
  case "${f}" in *.part-*) continue ;; esac
  size="$(stat -f %z "${f}" 2>/dev/null || stat -c %s "${f}")"
  if [[ "${size}" -gt "${LIMIT}" ]]; then
    info "$(basename "${f}"): $((size / 1048576)) Mo, cut into parts of ${PART_SIZE}"
    rm -f "${f}".part-*
    split -b "${PART_SIZE}" "${f}" "${f}.part-"
    for p in "${f}".part-*; do UPLOADS+=("${p}"); done
    NOTES_FILES="${NOTES_FILES}\n- \`$(basename "${f}")\`: download every \`$(basename "${f}").part-*\`, then rebuild it (macOS/Linux: \`cat $(basename "${f}").part-* > $(basename "${f}")\`; Windows: \`copy /b $(basename "${f}").part-aa+$(basename "${f}").part-ab ...\` in alphabetical order) and check \`$(basename "${f}").sha256\`."
  else
    UPLOADS+=("${f}")
  fi
done
info "Assets:"; for u in "${UPLOADS[@]}"; do printf '    %s (%s Mo)\n' "$(basename "${u}")" "$(( $(stat -f %z "${u}" 2>/dev/null || stat -c %s "${u}") / 1048576 ))"; done

if [[ ${UPLOAD} -eq 0 ]]; then ok "Built, not sent (--no-upload)."; exit 0; fi

# --- release: draft, upload, publish --------------------------------------------------------------------------------
NOTES="$(mktemp "${PROJECT_ROOT}/desktop/build/.release-notes.XXXXXX")"
{
  echo "${PRODUCT} ${TAG}"
  echo
  echo "Local app (image / audio / video generation). Packages are **not signed**: macOS (right-click → Open) and Windows (SmartScreen) warn on first launch."
  echo "Models and the stable-diffusion.cpp engine for your GPU are downloaded by the app on first launch."
  if [[ -n "${NOTES_FILES}" ]]; then echo; echo "Files cut under GitHub's 2 GiB limit:"; printf '%b\n' "${NOTES_FILES}"; fi
  if [[ -n "${NOTES_FILE}" ]]; then echo; cat "${NOTES_FILE}"; fi
} > "${NOTES}"
trap 'rm -f "${RUN_STAMP}" "${NOTES}"' EXIT

FLAGS=(--draft --target "$(git rev-parse HEAD)" --title "${PRODUCT} ${TAG}" --notes-file "${NOTES}")
[[ ${PRERELEASE} -eq 1 ]] && FLAGS+=(--prerelease)
gh release create "${TAG}" --repo "${REPO}" "${FLAGS[@]}"
for u in "${UPLOADS[@]}"; do
  info "Uploading $(basename "${u}")"
  ok_up=0
  for attempt in 1 2 3; do
    if gh release upload "${TAG}" "${u}" --repo "${REPO}" --clobber; then ok_up=1; break; fi
    warn "Upload failed (attempt ${attempt}/3)"
  done
  [[ ${ok_up} -eq 1 ]] || { err "Upload of ${u} failed; the draft ${TAG} is left on GitHub (gh release delete ${TAG} to drop it)"; exit 1; }
done
gh release edit "${TAG}" --repo "${REPO}" --draft=false
ok "Published: https://github.com/${REPO}/releases/tag/${TAG}"
