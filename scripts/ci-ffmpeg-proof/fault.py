#!/usr/bin/python3
"""Fault executable installed only in the disposable container's /control/bin."""
import json
import os
from pathlib import Path
import signal
import sys
import time

scenario = Path('/control/scenario').read_text().strip()
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with open('/control/invocations.jsonl', 'a') as out:
    out.write(json.dumps(dict(name=name, args=args, pid=os.getpid(), uid=os.getuid(), pgid=os.getpgrp(), sid=os.getsid(0))) + '\n')

def stall():
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    while True:
        time.sleep(1)

if scenario in ('cold', 'slow-first', 'slow-progress', 'signature', 'real-unpack-cancel', 'real-configure-stall', 'maintainer-cancel', 'maintainer-deadline'):
    os.execv('/usr/bin/' + name, [name] + args)
if name in ('ffmpeg', 'ffprobe'):
    if scenario == name + '-fail':
        sys.exit(19)
    if scenario == name + '-hang':
        stall()
    sys.exit(0)
if scenario in ('leader-group', 'negative-leader-only'):
    for uid in (0, 42):
        if os.fork() == 0:
            os.setuid(uid)
            stall()
    # Parent exits on TERM; both root and _apt descendants resist it.
    while True:
        time.sleep(1)
if scenario == 'apt-error':
    sys.exit(23)
if '--no-download' in args:
    if scenario in ('install-stall', 'cleanup-unproven', 'cancel-term', 'cancel-int', 'cancel-during-grace'):
        stall()
    if scenario == 'missing-archive':
        for deb in Path('/var/cache/apt/archives').glob('*.deb'):
            deb.unlink()
        os.execv('/usr/bin/apt-get', ['apt-get'] + args)
if scenario == 'missing-archive':
    os.execv('/usr/bin/apt-get', ['apt-get'] + args)
if scenario == 'slow-acquisitions':
    stall()
sys.exit(0)
