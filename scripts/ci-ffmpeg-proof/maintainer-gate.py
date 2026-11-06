#!/usr/bin/python3
"""A fault gate reached ONLY from the modified actual package .postinst."""
import json
import os
from pathlib import Path
import signal
import sys
import time

assert Path('/disposable-ffmpeg-proof').exists()
metadata = json.loads(Path('/control/maintainer-injection.json').read_text())
assert sys.argv[1] == metadata['script'] and sys.argv[2] == 'configure'
signal.signal(signal.SIGTERM, signal.SIG_IGN)
read_fd, write_fd = os.pipe()
children = []
for uid in (0, 42):
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        os.setuid(uid)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        os.write(write_fd, b'R')
        os.close(write_fd)
        while True:
            time.sleep(1)
    children.append(dict(pid=pid, uid=uid))
os.close(write_fd)
ready = b''
while len(ready) < 2:
    part = os.read(read_fd, 2 - len(ready))
    assert part, 'descendant identity/handler readiness failed'
    ready += part
os.close(read_fd)
record = dict(pid=os.getpid(), ppid=os.getppid(), pgid=os.getpgrp(), sid=os.getsid(0), script=sys.argv[1], args=sys.argv[2:], children=children, ready_boot_seconds=float(Path('/proc/uptime').read_text().split()[0]))
Path('/control/maintainer-ready.tmp').write_text(json.dumps(record, indent=2))
Path('/control/maintainer-ready.tmp').replace('/control/maintainer-ready.json')
while True:
    time.sleep(1)
