# Copyright (c) 2026 Stéphane Vaxelaire - Web3c
# SPDX-License-Identifier: MIT

"""Packaging regressions: root-dev workspaces and guard exit status. No models or hardware probes."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('collect_licenses', ROOT / 'scripts-local/collect_licenses.py')
licenses = importlib.util.module_from_spec(spec)
spec.loader.exec_module(licenses)


def write_package(root, key, **values):
    folder = root / key
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'package.json').write_text(json.dumps(values))
    (folder / 'LICENSE').write_text('Example licence text')
    return folder


def workspace(root, *, production=False, transitive=False):
    tool = write_package(root, 'tools/generator', name='@app/generator', private=True, license='MIT')
    write_package(root, 'node_modules/runtime', name='runtime', version='1.0.0', license='MIT')
    (root / 'node_modules/@app').mkdir()
    (root / 'node_modules/@app/generator').symlink_to(tool, target_is_directory=True)
    packages = {
        '': {'dependencies': {'runtime': '*', **({'@app/generator': '*'} if production else {})}, 'devDependencies': {'@app/generator': '*'}},
        'node_modules/runtime': {'version': '1.0.0', **({'dependencies': {'@app/generator': '*'}} if transitive else {})},
        'node_modules/@app/generator': {'link': True, 'resolved': 'tools/generator'},
        'tools/generator': {'name': '@app/generator', 'devDependencies': {'compiler': '*'}},
    }
    (root / 'package-lock.json').write_text(json.dumps({'packages': packages}))
    return packages


def test_dev_only_unversioned_workspace_is_not_a_redistributed_dependency(tmp_path):
    workspace(tmp_path)
    assert [(row['name'], row['version']) for row in licenses.npm_packages(tmp_path)] == [('runtime', '1.0.0')]


@pytest.mark.parametrize('production,transitive', [(True, False), (False, True)])
def test_missing_production_workspace_version_still_fails_closed(tmp_path, production, transitive):
    workspace(tmp_path, production=production, transitive=transitive)
    with pytest.raises(ValueError, match='has no version'):
        licenses.npm_packages(tmp_path)


def test_versioned_production_workspace_is_scanned_once_and_copyleft_still_blocks(tmp_path):
    workspace(tmp_path, production=True)
    write_package(tmp_path, 'tools/generator', name='@app/generator', version='1.0.0', license='GPL-3.0-only')
    rows = licenses.npm_packages(tmp_path)
    assert [row['name'] for row in rows].count('@app/generator') == 1
    errors, _warnings = licenses.classify(rows)
    assert len(errors) == 1 and 'strong copyleft' in errors[0]


@pytest.mark.skipif(shutil.which('zsh') is None, reason='macOS guard requires zsh')
@pytest.mark.parametrize('exit_code', [0, 7])
def test_memory_guard_preserves_child_exit_status(tmp_path, exit_code):
    # Deterministic memory readings; the guard never probes this test host or kills another process.
    commands = tmp_path / 'bin'
    commands.mkdir()
    for name, body in {
        'vm_stat': "printf 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\\nPages free: 1000000.\\n'",
        'ps': "printf '1 0 0\\n'",
    }.items():
        command = commands / name
        command.write_text('#!/bin/sh\n' + body + '\n')
        command.chmod(0o755)
    result = subprocess.run([shutil.which('zsh'), str(ROOT / 'scripts-local/guarded_run.sh'), '3', sys.executable, '-c', f'raise SystemExit({exit_code})'],
                            env={**os.environ, 'PATH': str(commands) + os.pathsep + os.defpath}, capture_output=True, text=True, timeout=10)
    assert result.returncode == exit_code, result.stdout + result.stderr
    assert f'exit={exit_code}' in result.stdout
