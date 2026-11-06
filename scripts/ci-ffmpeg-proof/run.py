"""Run one source-bound qualification in a fresh, disposable Ubuntu container."""
import atexit
import hashlib
import re
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from oracles import real_process_evidence, cancellation_evidence, expect_oracle_failure, process_lineage, is_descendant, mutating_install_evidence, maintainer_evidence

assert os.geteuid() == 0 and Path('/disposable-ffmpeg-proof').exists()
scenario = sys.argv[1]
control = Path('/control')
control.mkdir()
(control / 'initial-postinst.json').write_text(json.dumps([str(path) for path in Path('/var/lib/dpkg/info').glob('*.postinst')]))
(control / 'scenario').write_text(scenario)
(control / 'bin').mkdir()
atexit.register(lambda: subprocess.run(['cp', '-a', '/control/.', '/evidence/'], check=False))
for name in ('apt-get', 'ffmpeg', 'ffprobe'):
    (control / 'bin' / name).symlink_to('/candidate/scripts/ci-ffmpeg-proof/fault.py')
if scenario == 'launch-error':
    (control / 'bin' / 'apt-get').unlink()
    for name in ('sh', 'cat', 'sed'):
        (control / 'bin' / name).symlink_to('/bin/' + name)
helper = Path('/candidate/scripts/ci-ffmpeg.ts')
identity = dict(candidate=os.environ['CANDIDATE_SHA'], helper_sha256=hashlib.sha256(helper.read_bytes()).hexdigest(), scenario=scenario)
print(json.dumps(identity), flush=True)
subprocess.run(['sh', '-c', 'cat /etc/os-release; bun --version; apt-get --version | head -1; dpkg --version | head -1; timeout --version | head -1; uname -a'], check=True)
if scenario == 'baseline-negative':
    baseline = Path('/baseline')
    calls = [json.loads(line) for line in (baseline / 'invocations.jsonl').read_text().splitlines()]
    observations = [json.loads(line) for line in (baseline / 'processes.jsonl').read_text().splitlines()]
    old_trace = (baseline / 'process.trace').read_text()
    failure = expect_oracle_failure('33ea original source pre-exec dpkg escape', lambda: mutating_install_evidence(calls, old_trace, observations, ('--unpack', '--configure')))
    assert 'escaped installation descendant' in failure['expected_failure'], failure
    Path('/control/result.json').write_text(json.dumps(dict(**identity, baseline_candidate='33ea96fe831309b58a23b0811c72ee6990b1d5ec', baseline_trace_sha256=hashlib.sha256(old_trace.encode()).hexdigest(), attribution='post-hoc same-oracle re-evaluation, not a new execution', expected_failure=failure)))
    print(json.dumps(failure), flush=True)
    raise SystemExit(0)
# No host packages or databases are available to this fixture.
assert subprocess.run(['dpkg-query', '-W', 'ffmpeg'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0

env = os.environ.copy()
real = scenario in ('cold', 'slow-first', 'slow-progress', 'signature', 'real-unpack-cancel', 'real-configure-stall', 'maintainer-cancel', 'maintainer-deadline')
env['PATH'] = '/control/bin:' + env['PATH']
if scenario == 'launch-error':
    env['PATH'] = '/control/bin:/usr/local/bin'

if scenario in ('real-unpack-cancel', 'real-configure-stall'):
    Path('/etc/apt/apt.conf.d/99proof-dpkg-hook').write_text('DPkg::Options { "--pre-invoke=/candidate/scripts/ci-ffmpeg-proof/dpkg-hook.py"; };\n')

if scenario in ('maintainer-cancel', 'maintainer-deadline'):
    Path('/etc/apt/apt.conf.d/99proof-dpkg-hook').write_text('DPkg::Options { "--pre-invoke=/candidate/scripts/ci-ffmpeg-proof/maintainer-inject.py"; };\n')

# Real apt transport receives a continuously progressing but unusably slow
# response. It cannot escape the aggregate deadline through per-request progress.
if scenario in ('slow-first', 'slow-progress'):
    sources = Path('/etc/apt/sources.list.d/ubuntu.sources')
    sources.write_text(sources.read_text().replace('archive.ubuntu.com', 'azure.archive.ubuntu.com').replace('security.ubuntu.com', 'azure.archive.ubuntu.com').replace('ports.ubuntu.com', 'azure.archive.ubuntu.com'))
    class Proxy(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            with open('/control/proxy.jsonl', 'a') as out:
                out.write(json.dumps(dict(url=self.path, at=time.monotonic())) + '\n')
            if 'azure.archive.ubuntu.com' in self.path or scenario == 'slow-progress':
                self.send_response(200)
                self.send_header('Content-Length', '1000000')
                self.end_headers()
                try:
                    for _ in range(300):
                        self.wfile.write(b'x')
                        self.wfile.flush()
                        time.sleep(1)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                try:
                    backend = self.path.replace('archive.ubuntu.com', 'ports.ubuntu.com')
                    with open('/control/redirects.jsonl', 'a') as out:
                        out.write(json.dumps(dict(url=self.path, backend=backend)) + '\n')
                    self.send_response(302)
                    self.send_header('Location', backend)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                except Exception:
                    self.send_error(502)
        def log_message(self, *_):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 8123), Proxy)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    Path('/etc/apt/apt.conf.d/99proof-proxy').write_text('Acquire::http::Proxy "http://127.0.0.1:8123";\nAcquire::http::Proxy::ports.ubuntu.com "DIRECT";\n')
if scenario == 'signature':
    Path('/unsigned').mkdir()
    Path('/unsigned/Release').write_text('Origin: unsigned-proof\nLabel: unsigned-proof\nSuite: noble\nCodename: noble\n')
    Path('/etc/apt/sources.list.d/ubuntu.sources').unlink()
    Path('/etc/apt/sources.list').write_text('deb file:/unsigned noble main\n')
    Path('/unsigned/dists/noble').mkdir(parents=True)
    Path('/unsigned/dists/noble/Release').write_text(Path('/unsigned/Release').read_text())

# The standard entry point is unchanged. An imported test prelude can suppress
# only group KILL to prove its terminal cleanup-failure path with a real child.
entry = 'scripts/ci-ffmpeg.ts'
if scenario in ('cleanup-unproven', 'negative-leader-only'):
    # import.meta.main must stay true: --preload applies before the real entry.
    mutation = "if (pid < 0 && sig === 'SIGKILL') return true; return original(pid, sig);" if scenario == 'cleanup-unproven' else "return original(Math.abs(pid), sig);"
    Path('/control/preload.ts').write_text("const original = process.kill; process.kill = ((pid, sig) => { " + mutation + " }) as typeof process.kill;")

# Verification stalls/failures use a spent startup budget to keep individual
# controls fast. The install-stall case uses the full original 230-second work
# budget, with no reset or substituted entry point.
aged = scenario in ('ffmpeg-hang', 'ffprobe-hang', 'cleanup-unproven', 'leader-group', 'negative-leader-only')
launch = "read -r started _ < /proc/uptime; "
if aged:
    launch += "started=$(awk -v s=\"$started\" 'BEGIN {printf \"%.2f\", s-227}'); "
launch += 'printf "%s\\n" "$started" > /control/launch-stamp; '
preload = '--preload /control/preload.ts ' if scenario in ('cleanup-unproven', 'negative-leader-only') else ''
command = launch + f'/usr/bin/sudo -n --preserve-env=PATH /usr/local/bin/bun {preload}{entry} "$started" && touch /control/integration-started && touch /control/receipt-success'
start = time.monotonic()
log = open('/control/candidate.log', 'w')
# Trace session/group changes, identities and executable hooks, without reading
# credentials or package content. Observer itself stays outside candidate group.
process = subprocess.Popen(['/usr/bin/strace', '-f', '-ttt', '-o', '/control/process.trace', '-e', 'trace=process,setuid,setresuid,setreuid,setgid,setresgid,setsid,setpgid', '/bin/sh', '-ec', command], env=env, stdout=log, stderr=subprocess.STDOUT)
supervisor_pid = None
supervisor_exit_elapsed = None
snapshots = open('/control/processes.jsonl', 'w')
sent = False
signal_at = None
signal_pid = None
signal_identity = None
while process.poll() is None and time.monotonic() - start < 245:
    table = subprocess.check_output(['ps', '-eo', 'pid,ppid,pgid,sid,uid,stat,comm'], text=True)
    snapshots.write(json.dumps(dict(elapsed=time.monotonic()-start, table=table)) + '\n')
    snapshots.flush()
    for line in table.splitlines()[1:]:
        fields = line.split()
        if fields[-1] == 'bun':
            supervisor_pid = int(fields[0])
    if scenario in ('cleanup-unproven', 'negative-leader-only', 'cancel-term', 'cancel-int', 'cancel-during-grace', 'real-unpack-cancel', 'maintainer-cancel') and supervisor_pid and not Path(f'/proc/{supervisor_pid}').exists():
        supervisor_exit_elapsed = time.monotonic() - start
        break
    if scenario in ('cancel-term', 'cancel-int', 'cancel-during-grace', 'real-unpack-cancel', 'maintainer-cancel') and not sent:
        for line in table.splitlines()[1:]:
            fields = line.split()
            if fields[-1] == 'bun':
                # Wait until the real fault child exists before cancellation.
                if Path('/control/invocations.jsonl').exists() and '--no-download' in Path('/control/invocations.jsonl').read_text() and (scenario != 'real-unpack-cancel' or Path('/control/dpkg-hook-started.json').exists()) and (scenario != 'maintainer-cancel' or Path('/control/maintainer-ready.json').exists()):
                    signal_pid = int(fields[0])
                    signal_identity = Path(f'/proc/{signal_pid}/stat').read_text()
                    signal_at = time.monotonic() - start
                    os.kill(signal_pid, signal.SIGINT if scenario == 'cancel-int' else signal.SIGTERM)
                    sent = True
                    if scenario == 'cancel-during-grace':
                        time.sleep(0.1)
                        os.kill(signal_pid, signal.SIGINT)
    time.sleep(0.1)
# strace remains alive if an unkillable-by-candidate child still exists; observe
# Bun's own exit via trace before observer cleanup and retain that distinction.
elapsed = time.monotonic() - start
if scenario in ('cancel-term', 'cancel-int', 'cancel-during-grace', 'real-unpack-cancel', 'maintainer-cancel') and supervisor_exit_elapsed is None and process.poll() is not None:
    supervisor_exit_elapsed = elapsed
trace = Path('/control/process.trace').read_text()
if supervisor_pid is None:
    match = re.search(r'^\s*(\d+)\s+(?:\d+\.\d+\s+)?execve\("/usr/local/bin/bun"', trace, re.M)
    assert match, 'actual Bun candidate never executed'
    supervisor_pid = int(match[1])
if scenario == 'launch-error':
    assert re.search(rf'^\s*{supervisor_pid}\s+(?:\d+\.\d+\s+)?exit_group\(1\)', trace, re.M), 'launch error did not exercise candidate failure exit'
if scenario in ('cleanup-unproven', 'negative-leader-only'):
    assert supervisor_exit_elapsed is not None and supervisor_exit_elapsed < 12, 'supervisor did not exit within original spent-startup budget'
    assert 'process group cleanup unproven' in Path('/control/candidate.log').read_text()
    bound_exit = [line for line in trace.splitlines() if re.match(rf'^\s*{supervisor_pid}\s+(?:\d+\.\d+\s+)?exit_group\(1\)', line)]
    assert bound_exit, 'retain failure exit bound to observed Bun PID'
    Path('/control/supervisor-exit.trace').write_text('\n'.join(bound_exit))
    assert not Path('/control/integration-started').exists()
    assert not Path('/control/receipt-success').exists()
if process.poll() is None:
    print('OBSERVER: tracer still follows child; candidate exit is assessed separately', flush=True)
log.close()
content = Path('/control/candidate.log').read_text()
print(content, flush=True)
invocations = [json.loads(line) for line in Path('/control/invocations.jsonl').read_text().splitlines()] if Path('/control/invocations.jsonl').exists() else []
installs = [call for call in invocations if '--no-download' in call['args']]
markers = [str(path) for path in (Path('/control/integration-started'), Path('/control/receipt-success')) if path.exists()]
expected_success = scenario in ('cold', 'slow-first')
stamp = float(Path('/control/launch-stamp').read_text().strip())
original_elapsed = float(Path('/proc/uptime').read_text().split()[0]) - stamp
assert original_elapsed <= 240, dict(original_elapsed=original_elapsed, elapsed=elapsed, aged=aged)
result = dict(**identity, launch_stamp=stamp, original_launch_elapsed=original_elapsed, candidate_exit_code=1 if scenario in ('cleanup-unproven', 'negative-leader-only') else process.poll(), supervisor_pid=supervisor_pid, elapsed_seconds=elapsed, returncode=process.poll(), markers=markers, installs=len(installs), cancellation_sent=sent, signal_sent_at=signal_at, signal_pid=signal_pid, signal_identity=signal_identity, supervisor_exit_elapsed=supervisor_exit_elapsed, simulated_startup_seconds=227 if aged else 0)
Path('/control/result.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result), flush=True)
if scenario not in ('cleanup-unproven', 'negative-leader-only'):
    assert process.poll() is not None, 'actual process exit must be bounded'
    assert elapsed <= 240, result
    assert (process.returncode == 0) == expected_success, result
    assert bool(markers) == expected_success, result
    if not expected_success:
        assert 'PASS: ffmpeg and ffprobe ready' not in content
    assert len(installs) <= 1
controls = []
if real:
    observations = [json.loads(line) for line in Path('/control/processes.jsonl').read_text().splitlines()]
    facts = real_process_evidence(scenario, invocations, trace, observations)
    if scenario in ('cold', 'slow-first', 'real-unpack-cancel', 'real-configure-stall', 'maintainer-cancel', 'maintainer-deadline'):
        required = ('--unpack',) if scenario == 'real-unpack-cancel' else ('--unpack', '--configure')
        facts['mutating_install'] = mutating_install_evidence(invocations, trace, observations, required)
    if scenario in ('real-unpack-cancel', 'real-configure-stall'):
        assert Path('/control/dpkg-hook-started.json').exists(), 'actual mutating dpkg hook never reached'
        assert not any(call['name'] in ('ffmpeg', 'ffprobe') for call in invocations), 'verification admitted after interrupted installation'
    if scenario in ('maintainer-cancel', 'maintainer-deadline'):
        metadata = json.loads(Path('/control/maintainer-injection.json').read_text())
        ready = json.loads(Path('/control/maintainer-ready.json').read_text())
        assert hashlib.sha256(Path('/control/maintainer-original.postinst').read_bytes()).hexdigest() == metadata['original_sha256']
        assert hashlib.sha256(Path('/control/maintainer-modified.postinst').read_bytes()).hexdigest() == metadata['modified_sha256']
        facts['maintainer'] = maintainer_evidence(metadata, ready, trace, observations, facts['mutating_install'])
        assert ready['ready_boot_seconds'] - stamp < 230, 'maintainer gate did not precede original deadline'
        assert not any(call['name'] in ('ffmpeg', 'ffprobe') for call in invocations), 'verification admitted after interrupted maintainer'
        if scenario == 'maintainer-deadline':
            assert original_elapsed >= 230, 'maintainer failure did not exercise original deadline'
    Path('/control/real-process-facts.json').write_text(json.dumps(facts, indent=2))
    controls.append(expect_oracle_failure('missing real observations', lambda: real_process_evidence(scenario, [], '', [])))
    controls.append(expect_oracle_failure('undecodable real trace', lambda: real_process_evidence(scenario, invocations, 'syscall_0xBAD', observations)))
if scenario in ('cancel-term', 'cancel-int', 'cancel-during-grace', 'real-unpack-cancel', 'maintainer-cancel'):
    signal_name = 'SIGINT' if scenario == 'cancel-int' else 'SIGTERM'
    cancellation_evidence(sent, signal_pid, supervisor_pid, signal_at, supervisor_exit_elapsed, len(installs), trace, signal_name)
    if scenario == 'cancel-during-grace':
        assert re.search(rf'^\s*{supervisor_pid}\s+(?:\d+\.\d+\s+)?--- SIGINT\b', trace, re.M), 'second signal did not reach cleanup grace'
    assert elapsed < (150 if scenario in ('real-unpack-cancel', 'maintainer-cancel') else 20), 'ordinary original deadline expiry cannot qualify cancellation'
    controls.append(expect_oracle_failure('missing signal', lambda: cancellation_evidence(False, None, supervisor_pid, None, supervisor_exit_elapsed, len(installs), trace, signal_name)))
    controls.append(expect_oracle_failure('deadline-only shutdown', lambda: cancellation_evidence(True, supervisor_pid, supervisor_pid, 1, 230, 1, trace, signal_name)))
Path('/control/oracle-negative-controls.json').write_text(json.dumps(controls, indent=2))
# Record live group members before the observer is permitted to clean anything.
live = []
parents, _, _ = process_lineage(trace)
roots = {call['pid'] for call in invocations}
all_descendants = {pid for pid in parents if any(is_descendant(pid, root, parents) for root in roots)}
for call in invocations:
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            data = path.read_text().split(') ')[1].split()
            if (int(data[2]) == call['pgid'] or int(path.parent.name) in all_descendants) and data[0] not in ('Z', 'X'):
                live.append(dict(pid=path.parent.name, pgid=call['pgid'], state=data[0]))
        except FileNotFoundError:
            pass
Path('/control/survivors-before-observer.json').write_text(json.dumps(live, indent=2))
if scenario in ('cleanup-unproven', 'negative-leader-only'):
    assert live, 'suppressed/broken group KILL must expose live unresolved cleanup'
    assert len(installs) == (1 if scenario == 'cleanup-unproven' else 0)
    assert not any(call['name'] in ('ffmpeg', 'ffprobe') for call in invocations)
    assert 'PASS: ffmpeg and ffprobe ready' not in content
    if scenario == 'negative-leader-only':
        try:
            assert not live, live
        except AssertionError as expected_failure:
            Path('/control/expected-zero-survivor-failure.txt').write_text(str(expected_failure))
            print('EXPECTED FAILURE: same zero-live-members oracle detects leader-only mutation', flush=True)
        else:
            raise AssertionError('negative mutation escaped the survivor oracle')
else:
    assert not live, live
# Copy original failure evidence before any observer cleanup; container deletion
# is the final containment boundary for deliberately suppressed signals.
subprocess.run(['sh', '-c', 'cp -a /control/. /evidence/'], check=True)
if process.poll() is None:
    print('OBSERVER CLEANUP AFTER RETAINED FAILURE: killing intentionally surviving groups', flush=True)
    for call in invocations:
        try:
            os.killpg(call['pgid'], signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=3)
print('QUALIFICATION COMPLETE', flush=True)
