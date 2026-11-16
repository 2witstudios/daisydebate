"""DEC421 Linux-only supervisor. No SDK work precedes containment qualification."""
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from policy import GIB, LIMITS, refusal
from source_inputs import REFUSALS
from preparation import REFUSALS as PREPARATION_REFUSALS
from diagnostics import classify_failure, INPUT_BYTES

HERE = Path(__file__).resolve().parent
CANCELLED = False

def clock():
    return time.clock_gettime(time.CLOCK_BOOTTIME)

def emit(stage, **facts):
    print(json.dumps(dict(event='native.ownerCompile', stage=stage, **facts)), flush=True)

def run(args, **kwargs):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, **kwargs)
    except subprocess.TimeoutExpired:
        emit('command-refused', executable=Path(args[0]).name, category='command-timeout')
        raise RuntimeError('command-timeout')
    if result.returncode:
        emit('command-refused', executable=Path(args[0]).name, exitCode=result.returncode,
             stderrBytes=len(result.stderr), stderrSha256=hashlib.sha256(result.stderr).hexdigest())
        raise RuntimeError('command-refused')
    return result.stdout.decode().strip()

def refusal_code(error):
    known = {
        'command-timeout', 'command-refused', 'admission-cancelled', 'service-not-ready',
        'unit-cgroup-not-identified', 'containment-properties-refused',
        'session-escape-control-not-in-cgroup', 'fresh-resource-admission-refused',
        'descendants-not-joined-within-bound', 'native-linux-root-required',
        'budget-or-identity-refused', 'cgroup-v2-required', 'preflight-resource-refusal',
        'missing-tool', 'scratch-cap-not-enforced', 'watchdog-qualification-refused',
        'write-sandbox-qualification-refused', 'no-aged-compile-window', 'worker-report-refused', 'metadata-control-refusal', 'cgroup-kill-unavailable',
    }
    return str(error) if isinstance(error, RuntimeError) and str(error) in known else 'unclassified-supervisor-refusal'

def memory_available():
    return int(re.search(r'^MemAvailable:\s+(\d+)', Path('/proc/meminfo').read_text(), re.M)[1]) * 1024

def group_members(group):
    if not group.exists():
        return []
    return [int(pid) for path in group.rglob('cgroup.procs') for pid in path.read_text().split()]

def group_rss(group):
    total = 0
    for pid in set(group_members(group)):
        try:
            status = Path(f'/proc/{pid}/status').read_text()
            match = re.search(r'^VmRSS:\s+(\d+)', status, re.M)
            total += int(match[1]) * 1024 if match else 0
        except FileNotFoundError:
            pass
    return total

def sizes(root):
    counts = dict(sourceBytes=0, temporaryAndPrebuiltBytes=0, cargoBytes=0, cargoCacheBytes=0, targetBytes=0,
                  objectArtifactBytes=0, recognizedLinkArtifactBytes=0)
    seen = {key: set() for key in counts}
    for base, dirs, names in os.walk(root):
        dirs[:] = [name for name in dirs if not Path(base, name).is_symlink()]
        for name in names:
            path = Path(base, name)
            try:
                stat = path.lstat()
            except FileNotFoundError:
                continue
            value = stat.st_blocks * 512
            parts = path.relative_to(root).parts
            categories = []
            if parts[0] == 'source':
                categories.append('sourceBytes')
            if parts[0] in ('tmp', 'preparation'):
                categories.append('temporaryAndPrebuiltBytes')
            if parts[0] == 'cargo':
                categories.append('cargoBytes')
                if 'cache' in parts or parts[:3] == ('cargo', 'git', 'db'):
                    categories.append('cargoCacheBytes')
            if parts[0] == 'target':
                categories.append('targetBytes')
                if path.suffix in ('.o', '.obj', '.a', '.rlib', '.rmeta'):
                    categories.append('objectArtifactBytes')
                if path.suffix in ('.so', '.node', '.dylib', '.tmp', '.rsp'):
                    categories.append('recognizedLinkArtifactBytes')
            for category in categories:
                inode = (stat.st_dev, stat.st_ino)
                if inode not in seen[category]:
                    counts[category] += value
                    seen[category].add(inode)
    return counts

def properties(unit):
    text = run(['systemctl', 'show', unit, '-p', 'ControlGroup', '-p', 'MemoryMax',
                '-p', 'MemorySwapMax', '-p', 'ProtectSystem', '-p', 'ProtectControlGroups',
                '-p', 'KillMode', '-p', 'NoNewPrivileges', '-p', 'ExecMainStatus', '-p', 'Result'])
    return dict(line.split('=', 1) for line in text.splitlines() if '=' in line)

def stop_join(unit, group, observed):
    # Never make escalation depend on systemctl metadata or on a live leader.
    # The unit's explicit system.slice path is known before its start request.
    def request(args, timeout):
        try:
            return subprocess.run(args, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, timeout=timeout).returncode == 0
        except Exception:
            return False
    request(['systemctl', 'kill', '--kill-who=all', '--signal=SIGTERM', unit], 2)
    time.sleep(0.25)
    direct_kill = False
    try:
        if (group / 'cgroup.kill').exists():
            (group / 'cgroup.kill').write_text('1')
            direct_kill = True
    except OSError:
        pass
    request(['systemctl', 'kill', '--kill-who=all', '--signal=SIGKILL', unit], 2)
    stopped = request(['systemctl', 'stop', unit], 3)
    until = clock() + 2
    empty = False
    while clock() < until:
        try:
            empty = not group_members(group)
        except OSError:
            empty = False
        if empty:
            break
        time.sleep(0.05)
    # Absence alone is insufficient for an asynchronously pending start. Either
    # stop was accepted, or this exact Restart=no unit was already observed ready.
    return dict(joined=empty and (stopped or observed), kernelCgroupEmpty=empty,
                unitStopAccepted=stopped, directCgroupKillAttempted=direct_kill)

def supervise(root, mount, uid, gid, env, budget, mode, limits=LIMITS):
    if CANCELLED:
        raise RuntimeError('admission-cancelled')
    unit = f'daisy-owner-{os.getpid()}-{time.monotonic_ns()}.service'
    root.mkdir()
    os.chown(root, uid, gid)
    for name in ('tmp', 'home', 'cargo', 'target'):
        (root / name).mkdir()
        os.chown(root / name, uid, gid)
    deadline = clock() + budget
    command = [sys.executable, '-B', str(HERE / ('worker.py' if mode == 'build' else 'watchdog.py')),
               str(root), str(deadline - 10)] if mode == 'build' else [sys.executable, '-B', str(HERE / 'watchdog.py'), '--fault', str(root), mode]
    args = ['systemd-run', '--quiet', '--no-block', f'--unit={unit}',
            '--property=Type=exec', '--property=Slice=system.slice', '--property=Restart=no', '--property=ExitType=cgroup', '--property=RemainAfterExit=yes',
            f'--property=User={uid}', f'--property=Group={gid}',
            '--property=MemoryMax=8589934592', '--property=MemorySwapMax=0',
            '--property=CPUQuota=200%', '--property=TasksMax=512',
            '--property=KillMode=control-group', '--property=TimeoutStopSec=2',
            f'--property=RuntimeMaxSec={max(1, budget - 10)}',
            '--property=OOMPolicy=kill', '--property=NoNewPrivileges=yes',
            '--property=ProtectControlGroups=yes', '--property=ProtectSystem=strict',
            '--property=ProtectHome=read-only', '--property=PrivateDevices=yes', '--property=InaccessiblePaths=-/dev/shm -/run/user', f'--property=ReadWritePaths={mount}',
            f'--property=WorkingDirectory={root}',
            f'--property=StandardOutput=append:{root}/build.log',
            f'--property=StandardError=append:{root}/build.log']
    for key, value in dict(env, XDG_CACHE_HOME=str(root / 'home'), GIT_CONFIG_GLOBAL='/dev/null', GIT_CONFIG_NOSYSTEM='1', TMPDIR=str(root / 'tmp'),
                           CARGO_HOME=str(root / 'cargo'), CARGO_TARGET_DIR=str(root / 'target')).items():
        args.append(f'--setenv={key}={value}')
    group = Path('/sys/fs/cgroup/system.slice') / unit
    observed = False
    escape_qualified = False
    peaks = dict(aggregateRssBytes=0, cgroupMemoryPeakBytes=0, scratchFilesystemUsedBytes=0,
                 sourceBytes=0, temporaryAndPrebuiltBytes=0, cargoBytes=0, cargoCacheBytes=0, targetBytes=0,
                 objectArtifactBytes=0, recognizedLinkArtifactBytes=0)
    reason = None
    outcome = {}
    joined = False
    last_inventory = 0
    last_sample = None
    maximum_sample_gap = 0
    started = clock()
    try:
        run(args + command)
        ready = root / 'ready'
        while not ready.exists() and clock() < min(deadline - 10, started + 5):
            time.sleep(0.05)
        if not ready.exists():
            raise RuntimeError('service-not-ready')
        ready_pid = int(ready.read_text())
        if ready_pid not in group_members(group):
            raise RuntimeError('unit-cgroup-not-identified')
        observed = True
        if mode != 'build':
            child = json.loads((root / 'descendant.json').read_text())
            if child['pid'] not in group_members(group) or child['pgid'] != child['pid']:
                raise RuntimeError('session-escape-control-not-in-cgroup')
            escape_qualified = True
        if mode == 'metadata':
            raise RuntimeError('metadata-control-refusal')
        facts = properties(unit)
        if facts.get('ControlGroup') != '/system.slice/' + unit:
            raise RuntimeError('unit-cgroup-not-identified')
        if (facts.get('MemoryMax') != str(8 * GIB) or facts.get('MemorySwapMax') != '0'
                or facts.get('ProtectSystem') != 'strict' or facts.get('KillMode') != 'control-group'
                or facts.get('ProtectControlGroups') != 'yes' or facts.get('NoNewPrivileges') != 'yes'
                or not group.is_dir()):
            raise RuntimeError('containment-properties-refused')
        if not (group / 'cgroup.kill').exists():
            raise RuntimeError('cgroup-kill-unavailable')
        fs = os.statvfs(mount)
        admission = dict(now=clock(), deadline=deadline - 10,
                         scratch=(fs.f_blocks-fs.f_bfree)*fs.f_frsize,
                         free=shutil.disk_usage(mount.parent).free,
                         available=memory_available(), rss=group_rss(group))
        if CANCELLED or refusal(admission, limits):
            raise RuntimeError('fresh-resource-admission-refused')
        # Only this gate permits the worker to fetch or compile SDK source.
        (root / 'admit').touch()
        while True:
            now = clock()
            if last_sample is not None:
                maximum_sample_gap = max(maximum_sample_gap, now - last_sample)
            last_sample = now
            fs = os.statvfs(mount)
            sample = dict(now=now, deadline=deadline - 10,
                          scratch=(fs.f_blocks - fs.f_bfree) * fs.f_frsize,
                          free=shutil.disk_usage(mount.parent).free,
                          available=memory_available(), rss=group_rss(group))
            peaks['aggregateRssBytes'] = max(peaks['aggregateRssBytes'], sample['rss'])
            peaks['scratchFilesystemUsedBytes'] = max(peaks['scratchFilesystemUsedBytes'], sample['scratch'])
            try:
                peaks['cgroupMemoryPeakBytes'] = max(peaks['cgroupMemoryPeakBytes'], int((group / 'memory.peak').read_text()))
            except FileNotFoundError:
                pass
            if now - last_inventory >= 2:
                for key, value in sizes(root).items():
                    peaks[key] = max(peaks[key], value)
                last_inventory = now
            reason = 'cancelled' if CANCELLED else refusal(sample, limits)
            if reason or not group_members(group):
                break
            time.sleep(0.1)
        for key, value in sizes(root).items():
            peaks[key] = max(peaks[key], value)
        facts = properties(unit)
        outcome = dict(reason=reason, exitCode=int(facts.get('ExecMainStatus', '1')),
                       serviceResult=facts.get('Result', 'unknown'), **peaks)
    except Exception as error:
        outcome = dict(reason=refusal_code(error), exitCode=None, serviceResult='unknown', **peaks)
    finally:
        cleanup = stop_join(unit, group, observed)
        joined = cleanup['joined']
        outcome.update(cleanup)
    outcome.update(joined=joined, sessionEscapeQualified=escape_qualified, elapsedMs=round((clock() - started) * 1000),
                   hardBudgetSeconds=budget, pollSleepMs=100, inventoryIntervalMs=2000,
                   maximumSampleGapMs=round(maximum_sample_gap * 1000),
                   measurement='sampled RSS/filesystem and per-category unique inode blocks; kernel cgroup memory.peak; link suffix inventory is not complete linker scratch')
    emit('supervisor-outcome', mode=mode, **outcome)
    if not joined or clock() > deadline:
        raise RuntimeError('descendants-not-joined-within-bound')
    return outcome

def fault(root, mode):
    # Fault controls contain no SDK work. Include a TERM-resistant setsid descendant.
    import signal as signals
    child = subprocess.Popen([sys.executable, '-c',
        'import os,signal,time,json,sys; from pathlib import Path; os.setsid(); signal.signal(signal.SIGTERM,signal.SIG_IGN); Path(sys.argv[1]).write_text(json.dumps(dict(pid=os.getpid(),pgid=os.getpgrp()))); time.sleep(120)', str(root / 'descendant.json')])
    while not (root / 'descendant.json').exists():
        time.sleep(0.01)
    signals.signal(signals.SIGTERM, signals.SIG_IGN)
    (root / 'ready').write_text(str(os.getpid()))
    while not (root / 'admit').exists():
        time.sleep(0.01)
    sandbox = {}
    for key, path in [('outsideWriteRefused', Path('/tmp') / f'dec421-outside-{os.getpid()}'), ('sharedMemoryWriteRefused', Path('/dev/shm') / f'dec421-{os.getpid()}')]:
        try:
            path.write_text('bounded containment control')
            path.unlink()
            sandbox[key] = False
        except OSError as error:
            sandbox[key] = error.errno in (1, 2, 13, 30)
            sandbox[key + 'Errno'] = error.errno
    (root / 'sandbox.json').write_text(json.dumps(sandbox))
    if mode == 'rss':
        allocation = bytearray(64 * 1024 ** 2)
        allocation[:] = b'x' * len(allocation)
    while True:
        time.sleep(0.1)


def main():
    stage = 'preflight'
    exit_code = 1
    base = None
    mount = None
    mounted = False
    try:
        if sys.platform != 'linux' or os.geteuid() != 0 or os.uname().machine != 'x86_64':
            raise RuntimeError('native-linux-root-required')
        uid, gid, end_boot, cargo_bin, rustc_bin = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5]
        budget = int(end_boot - clock())
        if uid == 0 or budget < 60 or budget > 1800:
            raise RuntimeError('budget-or-identity-refused')
        if not Path('/sys/fs/cgroup/cgroup.controllers').is_file():
            raise RuntimeError('cgroup-v2-required')
        if shutil.disk_usage('/tmp').free < 41 * GIB or memory_available() < 2 * GIB:
            raise RuntimeError('preflight-resource-refusal')
        for tool in ('systemd-run', 'systemctl', 'fallocate', 'mkfs.ext4', 'mount', 'umount', 'git', 'clang++', 'pkg-config', 'make'):
            if shutil.which(tool) is None:
                emit('missing-tool', tool=tool)
                raise RuntimeError('missing-tool')
        base = Path(tempfile.mkdtemp(prefix='daisy-dec421-', dir='/tmp'))
        base.chmod(0o755)
        image = base / 'scratch.ext4'
        mount = base / 'scratch'
        mount.mkdir()
        stage = 'scratch-cap'
        run(['fallocate', '-l', str(20 * GIB), str(image)])
        run(['mkfs.ext4', '-q', '-m', '0', '-E', 'lazy_itable_init=0,lazy_journal_init=0', str(image)])
        run(['mount', '-o', 'loop,nodev,nosuid', str(image), str(mount)])
        mounted = True
        fs = os.statvfs(mount)
        if fs.f_blocks * fs.f_frsize > 20 * GIB:
            raise RuntimeError('scratch-cap-not-enforced')
        os.chown(mount, uid, gid)
        env = dict(PATH=str(Path(cargo_bin).parent) + ':/usr/local/bin:/usr/bin:/bin',
                   RUSTC=rustc_bin, RUSTDOC=str(Path(rustc_bin).with_name('rustdoc')),
                   CARGO_BUILD_JOBS='2', CMAKE_BUILD_PARALLEL_LEVEL='2', MAKEFLAGS='-j2',
                   RAYON_NUM_THREADS='2', CARGO_TERM_COLOR='never', CARGO_INCREMENTAL='0')
        emit('preflight', scratchCapBytes=20 * GIB, memoryMaxBytes=8 * GIB,
             diskFreeBytes=shutil.disk_usage(base).free, memAvailableBytes=memory_available(),
             compileHardMaximumSeconds=1800, admittedWindowSeconds=budget, jobs=2,
             cpuCount=os.cpu_count(), scratchFilesystemBytes=fs.f_blocks * fs.f_frsize)
        stage = 'qualification'
        for mode in ('deadline', 'rss', 'metadata'):
            limits = dict(LIMITS, rss=64 * 1024 ** 2) if mode == 'rss' else LIMITS
            proof = supervise(mount / mode, mount, uid, gid, env, 15, mode, limits)
            expected = {'rss': 'aggregate-rss', 'deadline': 'deadline', 'metadata': 'metadata-control-refusal'}[mode]
            if not proof['joined'] or not proof['directCgroupKillAttempted'] or proof['reason'] != expected:
                raise RuntimeError('watchdog-qualification-refused')
            emit('qualification', control=mode, **proof)
            if mode != 'metadata':
                sandbox = json.loads((mount / mode / 'sandbox.json').read_text())
                if not sandbox.get('outsideWriteRefused') or not sandbox.get('sharedMemoryWriteRefused'):
                    raise RuntimeError('write-sandbox-qualification-refused')
                emit('sandbox-qualified', control=mode, **sandbox)
            shutil.rmtree(mount / mode)
        stage = 'build-admission'
        budget = min(1800, int(end_boot - clock()))
        if budget < 60:
            raise RuntimeError('no-aged-compile-window')
        emit('build-admission', remainingHardWindowSeconds=budget, endBootSeconds=end_boot)
        stage = 'build'
        result = supervise(mount / 'build', mount, uid, gid, env, budget, 'build')
        status_file = mount / 'build/stage.json'
        if status_file.exists() and status_file.stat().st_size > 16384:
            raise RuntimeError('worker-report-refused')
        raw_status = json.loads(status_file.read_text()) if status_file.exists() else {}
        worker_stage = raw_status.get('stage', 'not-admitted')
        if worker_stage not in ('not-admitted', 'source-fetch', 'source-refused', 'prerequisite-prepare', 'prerequisite-refused', 'cargo-build', 'complete'):
            raise RuntimeError('worker-report-refused')
        versions = {}
        for tool in ('cargo', 'rustc', 'clang++'):
            value = raw_status.get('toolchain', {}).get(tool, '')
            match = re.search(r'\b([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9._]+)?)', value) if isinstance(value, str) else None
            versions[tool] = match[1] if match else None
        prerequisites = raw_status.get('prerequisiteTools', {})
        prerequisites = prerequisites if isinstance(prerequisites, dict) else {}
        observed_tools = {tool: prerequisites.get(tool) if isinstance(prerequisites.get(tool), bool) else None for tool in ('protoc', 'cmake', 'clang++', 'pkg-config', 'make')}
        prepared = raw_status.get('preparation', {})
        prepared = prepared if isinstance(prepared, dict) else {}
        preparation = {key: prepared.get(key) is True for key in ('signaturesVerified', 'libclangLoaded', 'importsAccepted', 'pkgConfigAccepted')}
        for key in ('compilerVersion', 'protocVersion'):
            value = prepared.get(key)
            preparation[key] = value if isinstance(value, str) and re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', value) else None
        for key in ('downloadBytes', 'expandedLogicalBytes'):
            value = prepared.get(key)
            preparation[key] = value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 2 * 1024 ** 3 else None
        step = raw_status.get('prerequisiteStep')
        step = step if isinstance(step, str) and re.fullmatch(r'[a-z0-9-]{1,64}', step) else None
        status = dict(stage=worker_stage, preparation=preparation, prerequisiteStep=step,
                      prerequisiteRefusal=raw_status.get('prerequisiteRefusal') if raw_status.get('prerequisiteRefusal') in PREPARATION_REFUSALS else None, sourceInputsVerified=raw_status.get('sourceInputsVerified') is True,
                      sourceRefusal=raw_status.get('sourceRefusal') if raw_status.get('sourceRefusal') in REFUSALS else None, prerequisiteTools=observed_tools, glibPkgConfig=raw_status.get('glibPkgConfig') if isinstance(raw_status.get('glibPkgConfig'), bool) else None, rustPin='7187f6a42ca6382b73c631b75a9d560253f5b90f',
                      nodePin='31d9d7e306e6c70c2eb748efde5afbded95a170e',
                      toolchainVersions=versions, profile='release', target='x86_64-unknown-linux-gnu',
                      jobs=2, qualification='stock pinned Node FFI baseline; no native owner implementation or runtime qualification')
        # Whitelisted worker facts contain no compiler output, environment, or raw exceptions.
        log = mount / 'build/build.log'
        log_bytes = log.stat().st_size if log.exists() else 0
        raw_tail = b''
        full_digest = None
        if log.exists():
            with log.open('rb') as stream:
                if log_bytes <= 16 * 1024 ** 2:
                    digest = hashlib.sha256()
                    for chunk in iter(lambda: stream.read(65536), b''):
                        digest.update(chunk)
                    full_digest = digest.hexdigest()
                stream.seek(max(0, log_bytes - INPUT_BYTES))
                raw_tail = stream.read(INPUT_BYTES)
        diagnostic = classify_failure(raw_tail.decode('utf8', errors='replace'), str(mount / 'build'))
        diagnostic.update(logTailSha256=hashlib.sha256(raw_tail).hexdigest(),
                          rawLogSha256=full_digest, logTruncated=log_bytes > len(raw_tail))
        emit('result', worker=status, logBytes=log_bytes,
             rustErrorCodes=diagnostic['rustErrorCodes'],
             linkerFailureObserved='linker' in diagnostic['observedSignals'],
             diagnostic=diagnostic, **result)
        exit_code = 0 if result['reason'] is None and result['exitCode'] == 0 and result['serviceResult'] == 'success' and status['stage'] == 'complete' else 1
    except Exception as error:
        emit('refused', failedStage=stage, category=refusal_code(error))
        exit_code = 1
    finally:
        if mounted:
            try:
                run(['umount', str(mount)])
                mounted = False
            except Exception:
                emit('cleanup-refused', category='scratch-still-mounted')
                exit_code = 1
        if base and not mounted:
            shutil.rmtree(base)
    return exit_code

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--fault':
        fault(Path(sys.argv[2]), sys.argv[3])
    else:
        def cancel(_signum, _frame):
            global CANCELLED
            CANCELLED = True
        signal.signal(signal.SIGTERM, cancel)
        signal.signal(signal.SIGINT, cancel)
        sys.exit(main())
