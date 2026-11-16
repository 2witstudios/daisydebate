"""Fixed-pin source inputs; refuse incomplete checkouts before Cargo admission."""
import hashlib
import subprocess

REFUSALS = ('source-head-mismatch', 'source-gitlink-mismatch', 'source-input-missing',
            'source-blob-mismatch', 'source-checkout-dirty')

class SourceRefusal(Exception):
    pass

def git(root, *args):
    return subprocess.check_output(['git', '-c', 'core.hooksPath=/dev/null', *args],
                                   cwd=root, text=True).strip()

def verify_gitlink(root, path, pin):
    if git(root, 'ls-tree', 'HEAD', '--', path) != f'160000 commit {pin}\t{path}':
        raise SourceRefusal('source-gitlink-mismatch')

def verify_checkout(root, pin, inputs):
    if git(root, 'rev-parse', 'HEAD') != pin:
        raise SourceRefusal('source-head-mismatch')
    for path, expected in inputs:
        target = root / path
        if target.is_symlink() or not target.is_file():
            raise SourceRefusal('source-input-missing')
        content = target.read_bytes()
        actual = hashlib.sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
        if actual != expected:
            raise SourceRefusal('source-blob-mismatch')
    if git(root, 'status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all'):
        raise SourceRefusal('source-checkout-dirty')
