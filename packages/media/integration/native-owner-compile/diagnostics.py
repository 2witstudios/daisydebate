"""Failure evidence is bounded/redacted before it can reach CI or a report."""
import re

INPUT_BYTES = 64 * 1024
OUTPUT_BYTES = 8192

def sanitize(line, scratch):
    line = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', line[:2048])
    line = ''.join(char for char in line if char == '\t' or ord(char) >= 32)
    line = re.sub(r'[a-zA-Z][a-zA-Z0-9+.-]*://[^\s\'"<>]+', '<url>', line)
    if re.search(r'(?i)\b(?:authorization|cookie)\s*[:=]|\bbearer\s+[A-Za-z0-9._~+/-]+=*', line):
        return '<credential-line>'
    assignments = re.finditer(r"""(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,255})\1\s*[:=](?!:)""", line)
    for assignment in assignments:
        key = assignment[2]
        words = re.sub(r'([a-z])([A-Z])', r'\1_\2', key).lower()
        parts = re.split(r'[_\-.]+', words)
        normalized = re.sub(r'[^a-z0-9]', '', words)
        if (any(part in ('authorization', 'password', 'passwd', 'secret', 'token', 'cookie', 'credential') for part in parts)
                or normalized.endswith(('token', 'password', 'passwd', 'secret'))
                or any(term in normalized for term in ('apikey', 'accesskey', 'privatekey'))):
            return '<credential-line>'
    line = line.replace(scratch.rstrip('/') + '/source', '<source>')
    line = line.replace(scratch.rstrip('/'), '<scratch>')
    line = re.sub(r'(?<![\w>])/[^\s\'"`<>():]+', '<path>', line)
    line = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '<email>', line)
    line = re.sub(r'[A-Za-z0-9_-]{32,}', '<opaque>', line)
    return line.replace('::', ': :')[:320]

def classify_failure(text, scratch):
    raw = text.encode('utf8', errors='replace')[-INPUT_BYTES:]
    lines = [sanitize(line, scratch) for line in raw.decode('utf8', errors='replace').splitlines()]
    cleaned = '\n'.join(lines)
    patterns = [
        ('disk-full', r'no space left|os error 28\b'),
        ('memory-allocation', r'cannot allocate memory|out of memory|os error 12\b'),
        ('filesystem-permission', r'permission denied|read-only file system|os error (?:13|30)\b'),
        ('missing-prerequisite', r'(?:could not find|not found|no such file).{0,80}(?:protoc|cmake|pkg-config|clang)|(?:protoc|cmake|pkg-config|clang).{0,80}(?:not found|no such file)'),
        ('network', r'failed to download|failed to send.{0,30}http|certificate|connection (?:refused|reset)|timed out|http.*(?:403|404|429|500|502|503)'),
        ('linker', r'linking with .*failed|undefined reference|linker.*(?:failed|not found)'),
        ('rust-compiler', r'error\[E[0-9]{4}\]'),
        ('build-script', r'failed to run custom build command|panicked at'),
    ]
    matches = [name for name, pattern in patterns if re.search(pattern, cleaned, re.I)]
    relevant = set()
    for index, line in enumerate(lines):
        if re.search(r'error|caused by|panicked|failed|cannot|could not|not found|permission|os error|read-only|linker|undefined|protoc|pkg-config|fatal', line, re.I):
            relevant.update(range(max(0, index - 1), min(len(lines), index + 4)))
    relevant.update(range(max(0, len(lines) - 12), len(lines)))
    selected = sorted(relevant)[-24:]
    excerpt = '\n'.join(lines[index] for index in selected).encode('utf8')[:OUTPUT_BYTES].decode('utf8', errors='ignore')
    package = re.search(r'custom build command for [`\'"]+([A-Za-z0-9_-]{1,64})', cleaned)
    codes = sorted(set(re.findall(r'error\[(E[0-9]{4})\]', cleaned)))[:32]
    causes = [name for name in matches if name != 'build-script']
    return dict(category=causes[0] if causes else 'unknown', observedSignals=matches,
                buildScriptPackage=package[1] if package else None,
                rustErrorCodes=codes, osErrorNumbers=sorted(set(map(int, re.findall(r'os error ([0-9]{1,4})\b', cleaned))))[:16],
                excerpt=excerpt, excerptBytes=len(excerpt.encode('utf8')),
                inputTailBytes=len(raw), inputTruncated=len(text.encode('utf8')) > INPUT_BYTES,
                classification='observed diagnostic patterns; unknown remains explicit')
