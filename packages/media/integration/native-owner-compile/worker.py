"""Fixed-pin stock Node FFI build, inside the prequalified cgroup/filesystem."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import time
from source_inputs import SourceRefusal, verify_checkout, verify_gitlink

PIN = '7187f6a42ca6382b73c631b75a9d560253f5b90f'
NODE_PIN = '31d9d7e306e6c70c2eb748efde5afbded95a170e'
SUBMODULES = (
    ('livekit-protocol/protocol', 'https://github.com/livekit/protocol.git',
     '3fbe509850cb24aa90a0bc20134936698333dceb',
     (('livekit/agent/thread_schema_v1.sql', '8980979d068173c9e3bd038c105b13cd6fd1f448'),)),
    ('yuv-sys/libyuv', 'https://chromium.googlesource.com/libyuv/libyuv',
     '917276084a49be726c90292ff0a6b0a3d571a6af',
     (('include/libyuv.h', 'a06e1233abb674d587478440a11f64eb2e702b0d'),
      ('source/convert.cc', 'd175bbc4411762f29bc0d9e7dd0afa14d5ba8055'),
      ('source/row_common.cc', '3062fd8f9eb9ca8f79db4c2257c7fad0ba1a150e'))),
)
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
    verify_checkout(source, PIN, (
        ('Cargo.lock', '2db6427341cbb6a0f3763354ea29797e524e88c0'),
        ('.gitmodules', 'b70842c2afaab1faa70046c8cb8b755c0be1bdb5'),
        ('livekit-protocol/src/lib.rs', '0f6566c46d983db2665e679e8cf77f760748267a'),
        ('yuv-sys/build.rs', 'c4d52be11b70c8958fba45b5919308bb0f7bc7a4'),
        ('webrtc-sys/build.rs', '3791253050956a0d6ffc09dc8f03ace44905843f'),
        ('webrtc-sys/build/src/lib.rs', '586b6675123cffb1f8b5d99ce0ffa6d8744e9250'),
    ))
    for relative, url, pin, inputs in SUBMODULES:
        # URLs are fixed allowlisted literals, identities must match the parent gitlinks.
        verify_gitlink(source, relative, pin)
        checkout = source / relative
        checkout.mkdir(parents=True, exist_ok=True)
        command(['git', 'init', '--quiet', str(checkout)])
        command(['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null',
                 'fetch', '--quiet', '--depth=1', url, pin], checkout)
        command(['git', '-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], checkout)
        verify_checkout(checkout, pin, inputs)
    toolchain = {}
    for tool in ('cargo', 'rustc', 'clang++'):
        toolchain[tool] = subprocess.check_output([tool, '--version'], text=True).splitlines()[0]
    prerequisite_tools = {name: shutil.which(name) is not None for name in ('protoc', 'cmake', 'clang++', 'pkg-config', 'make')}
    try:
        glib = subprocess.run(['pkg-config', '--exists', 'glib-2.0'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2).returncode == 0
    except Exception:
        glib = None
    stage('cargo-build', prerequisiteTools=prerequisite_tools, glibPkgConfig=glib, rustPin=PIN, nodePin=NODE_PIN, sourceInputsVerified=True, toolchain=toolchain,
          profile='release', target='x86_64-unknown-linux-gnu', jobs=2,
          qualification='stock pinned Node FFI baseline; native owner not implemented')
    command(['cargo', 'build', '--locked', '--release', '--jobs', '2',
             '--target', 'x86_64-unknown-linux-gnu', '-p', 'rtc-node-ffi-bindings'], source)
    stage('complete', prerequisiteTools=prerequisite_tools, glibPkgConfig=glib, rustPin=PIN, nodePin=NODE_PIN, sourceInputsVerified=True, toolchain=toolchain,
          profile='release', jobs=2, qualification='compile only; no runtime execution')
except SourceRefusal as error:
    stage('source-refused', sourceRefusal=str(error), rustPin=PIN, nodePin=NODE_PIN)
    print('error: fixed-pin source input refused: ' + str(error), flush=True)
    sys.exit(1)
except Exception:
    # The supervisor retains the stage and bounded redacted compiler-failure evidence.
    sys.exit(1)
