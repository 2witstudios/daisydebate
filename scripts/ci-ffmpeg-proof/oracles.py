"""Fail-closed evidence predicates shared by qualification and negative controls."""
import re


def real_process_evidence(scenario, invocations, trace, snapshots):
    assert invocations, 'missing real executable history'
    assert 'syscall_0x' not in trace, 'undecodable observer trace'
    assert re.search(r'execve\("/usr/bin/apt-get"', trace), 'missing actual apt execution'
    apt = [call for call in invocations if call['name'] == 'apt-get']
    assert apt, 'missing real apt invocation'
    assert all(call['pid'] == call['pgid'] == call['sid'] and call['uid'] == 0 for call in apt), 'apt must start in root-owned session/group'
    groups = {call['pgid'] for call in apt}
    rows = [line.split() for snapshot in snapshots for line in snapshot['table'].splitlines()[1:]]
    if scenario in ('cold', 'slow-first', 'slow-progress', 'real-unpack-cancel', 'real-configure-stall'):
        assert re.search(r'execve\("/usr/lib/apt/methods/http', trace), 'missing actual apt HTTP method'
        assert any(len(row) >= 7 and int(row[2]) in groups and row[4] == '42' and row[-1] in ('http', 'https') for row in rows), 'missing _apt transport in actual apt group'
    if scenario in ('cold', 'slow-first', 'real-unpack-cancel', 'real-configure-stall'):
        assert re.search(r'execve\("/usr/bin/dpkg"', trace), 'missing actual dpkg'
        if scenario in ('cold', 'slow-first'):
            assert '/var/lib/dpkg/info/' in trace and '.postinst' in trace, 'missing actual maintainer hook execution'
        else:
            assert '/candidate/scripts/ci-ffmpeg-proof/dpkg-hook.py' in trace, 'missing actual dpkg invoke hook'
        assert any(len(row) >= 7 and int(row[2]) in groups and row[4] == '0' and row[-1] == 'dpkg' for row in rows), 'missing root dpkg in actual apt group'
        assert re.search(r'execve\("/usr/lib/apt/methods/gpgv"', trace), 'missing actual signature verifier'
        assert len([call for call in apt if '--no-download' in call['args']]) == 1, 'real installation must occur exactly once'
        if scenario in ('cold', 'slow-first'):
            assert {call['name'] for call in invocations} >= {'apt-get', 'ffmpeg', 'ffprobe'}, 'missing both real binary verifications'
    else:
        assert not any('--no-download' in call['args'] for call in apt), 'failed acquisition must not install'
    # No observed workload may deliberately leave its assigned process group.
    workload = set()
    for line in trace.splitlines():
        match = re.match(r'\s*(\d+)\s+', line)
        if not match:
            continue
        pid = match[1]
        if re.search(r'execve\("(?:/usr/bin/apt-get|/usr/bin/dpkg|/usr/lib/apt/methods/|/var/lib/dpkg/info/)', line):
            workload.add(pid)
        if pid in workload and re.search(r'(?:setpgid|setsid)\([^\n]*= (?:0|[1-9][0-9]*)$', line):
            raise AssertionError('observed workload group escape needs investigation')
    return dict(apt_groups=sorted(groups), observed_process_rows=len(rows), installs=sum('--no-download' in call['args'] for call in apt))


def cancellation_evidence(sent, signal_pid, supervisor_pid, sent_at, exited_at, installs, trace, signal_name):
    assert sent and signal_pid == supervisor_pid and sent_at is not None, 'missing exact supervisor signal delivery'
    assert installs == 1, 'cancellation did not reach the intended install phase'
    assert exited_at is not None and exited_at - sent_at <= 7, 'cancellation fell through to normal deadline'
    assert re.search(rf'^\s*{supervisor_pid}\s+(?:\d+\.\d+\s+)?--- {signal_name}\b', trace, re.M), 'missing exact supervisor signal reception'


def expect_oracle_failure(name, check):
    try:
        check()
    except AssertionError as failure:
        return dict(control=name, expected_failure=str(failure))
    raise AssertionError(f'negative control {name} unexpectedly passed')


def process_lineage(trace):
    parents = {}
    transitions = []
    mutating = {}
    for line in trace.splitlines():
        prefix = re.match(r'\s*(\d+)\s+', line)
        if not prefix:
            continue
        pid = int(prefix[1])
        if re.search(r'(?:clone3?|vfork|fork)(?:\(| resumed>)', line):
            child = re.search(r'= (\d+)\s*$', line)
            if child:
                parents[int(child[1])] = pid
        if re.search(r'(?:setsid|setpgid)(?:\(| resumed>)', line) and re.search(r'= \d+\s*$', line):
            transitions.append((pid, line))
        if 'execve("/usr/bin/dpkg"' in line:
            for operation in ('--unpack', '--configure'):
                if '"' + operation + '"' in line:
                    mutating[pid] = operation
    return parents, transitions, mutating


def is_descendant(pid, root, parents):
    seen = set()
    while pid in parents and pid not in seen:
        seen.add(pid)
        pid = parents[pid]
        if pid == root:
            return True
    return False


def mutating_install_evidence(invocations, trace, snapshots, required_operations):
    installs = [call for call in invocations if '--no-download' in call['args']]
    assert len(installs) == 1, 'exactly one real installation required'
    root = installs[0]['pid']
    parents, transitions, mutating = process_lineage(trace)
    assert set(mutating.values()) >= set(required_operations), 'missing required MUTATING dpkg operations'
    assert all(is_descendant(pid, root, parents) for pid in mutating), 'missing mutating dpkg ancestry to installation'
    escapes = [(pid, line) for pid, line in transitions if is_descendant(pid, root, parents)]
    assert not escapes, 'escaped installation descendant before/after exec: ' + str(escapes)
    rows = [line.split() for snapshot in snapshots for line in snapshot['table'].splitlines()[1:]]
    for pid in mutating:
        assert any(len(row) >= 7 and int(row[0]) == pid and int(row[2]) == root and int(row[3]) == root and row[4] == '0' for row in rows), f'mutating dpkg {pid} never observed in install PGID/SID'
    return dict(install_pid=root, mutating_pids=mutating, descendant_pids=sorted(pid for pid in parents if is_descendant(pid, root, parents)), escaped_transitions=escapes)
