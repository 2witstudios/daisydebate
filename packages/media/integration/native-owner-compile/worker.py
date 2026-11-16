"""Fixed-pin stock Node FFI build, inside the prequalified cgroup/filesystem."""
import hashlib
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import time

PIN = '7187f6a42ca6382b73c631b75a9d560253f5b90f'
NODE_PIN = '31d9d7e306e6c70c2eb748efde5afbded95a170e'
root = Path(sys.argv[1])

def command(args, cwd=root):
    subprocess.run(args, cwd=cwd, check=True, timeout=None)

def stage(name, **facts):
    (root / 'stage.json').write_text(json.dumps(dict(stage=name, **facts)))

try:
    (root / 'ready').write_text(str(os.getpid()))
    while not (root / 'admit').exists():
        time.sleep(0.01)
    stage('source-fetch', rustPin=PIN, nodePin=NODE_PIN)
    source = root / 'source'
    source.mkdir()
    command(['git', 'init', '--quiet', str(source)])
    command(['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null',
             'fetch', '--quiet', '--depth=1', 'https://github.com/livekit/rust-sdks.git', PIN], source)
    command(['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], source)
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    if actual != PIN:
        raise ValueError('fixed source identity refused')
    for path, expected in [
        ('Cargo.lock', '2db6427341cbb6a0f3763354ea29797e524e88c0'),
        ('webrtc-sys/build.rs', '3791253050956a0d6ffc09dc8f03ace44905843f'),
        ('webrtc-sys/build/src/lib.rs', '586b6675123cffb1f8b5d99ce0ffa6d8744e9250'),
    ]:
        content = (source / path).read_bytes()
        blob = hashlib.sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
        if blob != expected:
            raise ValueError('fixed source blob refused')
    toolchain = {}
    for tool in ('cargo', 'rustc', 'clang++'):
        toolchain[tool] = subprocess.check_output([tool, '--version'], text=True).splitlines()[0]
    prerequisite_tools = {name: shutil.which(name) is not None for name in ('protoc', 'cmake', 'clang++', 'pkg-config', 'make')}
    try:
        glib = subprocess.run(['pkg-config', '--exists', 'glib-2.0'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2).returncode == 0
    except Exception:
        glib = None
    stage('cargo-build', prerequisiteTools=prerequisite_tools, glibPkgConfig=glib, rustPin=actual, nodePin=NODE_PIN, toolchain=toolchain,
          profile='release', target='x86_64-unknown-linux-gnu', jobs=2,
          qualification='stock pinned Node FFI baseline; native owner not implemented')
    command(['cargo', 'build', '--locked', '--release', '--jobs', '2',
             '--target', 'x86_64-unknown-linux-gnu', '-p', 'rtc-node-ffi-bindings'], source)
    stage('complete', prerequisiteTools=prerequisite_tools, glibPkgConfig=glib, rustPin=actual, nodePin=NODE_PIN, toolchain=toolchain,
          profile='release', jobs=2, qualification='compile only; no runtime execution')
except Exception:
    # The supervisor retains the stage and bounded redacted compiler-failure evidence.
    sys.exit(1)
