#!/usr/bin/python3
"""Only a disposable real-dpkg invocation hook may execute this fault."""
import json
import os
from pathlib import Path
import signal
import time

assert Path('/disposable-ffmpeg-proof').exists()
scenario = Path('/control/scenario').read_text().strip()
action = os.environ.get('DPKG_HOOK_ACTION')
if action != ('unpack' if scenario == 'real-unpack-cancel' else 'configure'):
    raise SystemExit(0)
record = dict(pid=os.getpid(), ppid=os.getppid(), pgid=os.getpgrp(), sid=os.getsid(0), action=action)
Path('/control/dpkg-hook-started.json').write_text(json.dumps(record))
for uid in (0, 42):
    if os.fork() == 0:
        os.setuid(uid)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        while True:
            time.sleep(1)
# Parent keeps dpkg's actual pre-invoke operation blocked until cancellation.
while True:
    time.sleep(1)
