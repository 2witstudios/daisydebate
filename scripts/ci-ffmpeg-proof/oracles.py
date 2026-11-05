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
    if scenario in ('cold', 'slow-first', 'slow-progress'):
        assert re.search(r'execve\("/usr/lib/apt/methods/http', trace), 'missing actual apt HTTP method'
        assert any(len(row) >= 7 and int(row[2]) in groups and row[4] == '42' and row[-1] in ('http', 'https') for row in rows), 'missing _apt transport in actual apt group'
    if scenario in ('cold', 'slow-first'):
        assert re.search(r'execve\("/usr/bin/dpkg"', trace), 'missing actual dpkg'
        assert '/var/lib/dpkg/info/' in trace and '.postinst' in trace, 'missing actual maintainer hook execution'
        assert any(len(row) >= 7 and int(row[2]) in groups and row[4] == '0' and row[-1] == 'dpkg' for row in rows), 'missing root dpkg in actual apt group'
        assert re.search(r'execve\("/usr/lib/apt/methods/gpgv"', trace), 'missing actual signature verifier'
        assert len([call for call in apt if '--no-download' in call['args']]) == 1, 'real installation must occur exactly once'
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
