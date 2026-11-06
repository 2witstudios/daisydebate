#!/usr/bin/python3
"""Disposable-only modification of a freshly authenticated/unpacked .postinst."""
import difflib
import hashlib
import json
import os
from pathlib import Path

assert Path('/disposable-ffmpeg-proof').exists()
if os.environ.get('DPKG_HOOK_ACTION') != 'configure' or Path('/control/maintainer-injection.json').exists():
    raise SystemExit(0)
initial = set(json.loads(Path('/control/initial-postinst.json').read_text()))
for script in sorted(Path('/var/lib/dpkg/info').glob('*.postinst')):
    original = script.read_bytes()
    if str(script) in initial or not original.startswith((b'#!/bin/sh\n', b'#!/bin/bash\n')):
        continue
    package = script.name.removesuffix('.postinst').split(':')[0]
    records = Path('/var/lib/dpkg/status').read_text().split('\n\n')
    record = next(item for item in records if item.startswith('Package: ' + package + '\n'))
    fields = dict(line.split(': ', 1) for line in record.splitlines() if ': ' in line and not line.startswith(' '))
    assert fields['Status'].endswith(' unpacked'), 'selected package must be freshly unpacked'
    shebang, body = original.split(b'\n', 1)
    modified = shebang + b'\n# Disposable ISSUE-1356 fault gate; original body follows unchanged.\n/usr/bin/python3 /candidate/scripts/ci-ffmpeg-proof/maintainer-gate.py "$0" "$@"\n' + body
    Path('/control/maintainer-original.postinst').write_bytes(original)
    script.write_bytes(modified)
    Path('/control/maintainer-modified.postinst').write_bytes(modified)
    Path('/control/maintainer.diff').write_text(''.join(difflib.unified_diff(original.decode().splitlines(True), modified.decode().splitlines(True), fromfile=str(script) + '.original', tofile=str(script) + '.injected')))
    Path('/control/maintainer-injection.json').write_text(json.dumps(dict(package=package, version=fields['Version'], architecture=fields['Architecture'], status=fields['Status'], script=str(script), action='configure', injector_pid=os.getpid(), original_sha256=hashlib.sha256(original).hexdigest(), modified_sha256=hashlib.sha256(modified).hexdigest(), label='authenticated package unpack followed by disposable modification of actual package maintainer script; interruption inside injected gate'), indent=2))
    raise SystemExit(0)
raise SystemExit('No freshly unpacked supported package .postinst found')
