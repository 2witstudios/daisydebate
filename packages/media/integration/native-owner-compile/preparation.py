"""Pinned data preparation inside the already-qualified worker, before Cargo."""
import gzip
import hashlib
import io
import json
import lzma
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request
import zipfile

REFUSALS = ('preparation-identity', 'preparation-download', 'preparation-signature',
            'preparation-index', 'preparation-archive', 'preparation-prerequisite',
            'insufficient-compile-window')

class PreparationRefusal(Exception):
    pass

def require(condition, category):
    if not condition:
        raise PreparationRefusal(category)

def remaining(deadline):
    return deadline - time.clock_gettime(time.CLOCK_BOOTTIME)

def cargo_window(deadline):
    require(remaining(deadline) >= 60, 'insufficient-compile-window')

def checked(args, env=None, category='preparation-prerequisite'):
    try:
        result = subprocess.run(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        raise PreparationRefusal(category)
    if result.returncode:
        print('error: prerequisite command ' + Path(args[0]).name + ' exit ' + str(result.returncode), flush=True)
        print(result.stderr.decode('utf8', errors='replace')[-4096:], flush=True)
        raise PreparationRefusal(category)
    return result.stdout.decode('utf8', errors='replace').strip()

class Acquisition:
    def __init__(self, root, deadline):
        self.root, self.deadline, self.bytes = root, deadline, 0
        self.cache = {}

    def fetch(self, spec):
        identity = spec['sha256']
        if identity in self.cache:
            return self.cache[identity]
        require(remaining(self.deadline) > 60, 'insufficient-compile-window')
        path = self.root / identity
        digest = hashlib.sha256()
        count = 0
        try:
            with urllib.request.urlopen(spec['url'], timeout=15) as response, path.open('wb') as output:
                require(response.geturl().startswith('https://'), 'preparation-download')
                while True:
                    require(remaining(self.deadline) > 60, 'insufficient-compile-window')
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    self.bytes += len(chunk)
                    require(count <= spec['bytes'] and self.bytes <= 256 * 1024 ** 2, 'preparation-download')
                    digest.update(chunk)
                    output.write(chunk)
        except (OSError, ValueError):
            raise PreparationRefusal('preparation-download')
        require(count == spec['bytes'] and digest.hexdigest() == identity, 'preparation-download')
        self.cache[identity] = path
        return path

class Extraction:
    def __init__(self, root):
        self.root, self.bytes, self.entries = root.resolve(), 0, 0
        self.root.mkdir(parents=True, exist_ok=True)
        self.links = []
        self.seen = set()

    def path(self, name):
        parts = PurePosixPath(name).parts
        require(bool(parts) and not name.startswith('/') and '..' not in parts and '\\' not in name and '\0' not in name,
                'preparation-archive')
        target = self.root.joinpath(*parts)
        require(target.is_relative_to(self.root), 'preparation-archive')
        return target

    def member(self, name, size, kind, stream=None, link=None, mode=0):
        target = self.root if kind == 'directory' and name in ('.', './') else self.path(name)
        self.entries += 1
        self.bytes += size
        require(self.entries <= 100000 and self.bytes <= 2 * 1024 ** 3, 'preparation-archive')
        require(kind in ('directory', 'file', 'symlink', 'hardlink'), 'preparation-archive')
        if kind == 'directory':
            require(not target.exists() or target.is_dir(), 'preparation-archive')
            target.mkdir(parents=True, exist_ok=True)
            return
        require(target != self.root and target not in self.seen, 'preparation-archive')
        self.seen.add(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        if kind in ('symlink', 'hardlink'):
            require(link and not link.startswith('/') and '\\' not in link and '\0' not in link, 'preparation-archive')
            destination = (target.parent / link if kind == 'symlink' else self.path(link)).resolve()
            require(destination.is_relative_to(self.root), 'preparation-archive')
            self.links.append((target, link, kind))
            return
        require(stream is not None, 'preparation-archive')
        written = 0
        with target.open('xb') as output:
            while True:
                chunk = stream.read(min(1024 * 1024, size - written + 1))
                if not chunk:
                    break
                written += len(chunk)
                require(written <= size, 'preparation-archive')
                output.write(chunk)
        require(written == size, 'preparation-archive')
        target.chmod(0o755 if mode & 0o111 else 0o644)

    def finish(self):
        # All data is written before any link can redirect a later file write.
        for target, link, kind in self.links:
            if kind == 'symlink':
                require(target.parent.resolve().is_relative_to(self.root) and (target.parent / link).resolve().is_relative_to(self.root), 'preparation-archive')
                require(not target.exists() and not target.is_symlink(), 'preparation-archive')
                target.symlink_to(link)
        for target, link, kind in self.links:
            destination = (target.parent / link if kind == 'symlink' else self.path(link)).resolve()
            require(destination.is_relative_to(self.root), 'preparation-archive')
            if kind == 'hardlink':
                require(target.parent.resolve().is_relative_to(self.root), 'preparation-archive')
                require(destination.is_file(), 'preparation-archive')
                os.link(destination, target)

    def deb(self, path, temporary):
        with path.open('rb') as archive:
            require(archive.read(8) == b'!<arch>\n', 'preparation-archive')
            found = False
            while header := archive.read(60):
                require(len(header) == 60 and header[58:] == b'`\n', 'preparation-archive')
                name, size = header[:16].decode().strip().rstrip('/'), int(header[48:58])
                if name.startswith('data.tar'):
                    require(not found, 'preparation-archive')
                    found = True
                    data = temporary / (path.name + '.data')
                    with data.open('wb') as output:
                        left = size
                        while left:
                            chunk = archive.read(min(left, 1024 * 1024))
                            require(bool(chunk), 'preparation-archive')
                            output.write(chunk)
                            left -= len(chunk)
                    process = None
                    if name.endswith('.zst'):
                        process = subprocess.Popen(['zstd', '-d', '-c', str(data)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                        stream = process.stdout
                    elif name.endswith('.xz'):
                        stream = lzma.open(data, 'rb')
                    elif name.endswith('.gz'):
                        stream = gzip.open(data, 'rb')
                    else:
                        raise PreparationRefusal('preparation-archive')
                    try:
                        with tarfile.open(fileobj=stream, mode='r|') as members:
                            for member in members:
                                kind = 'directory' if member.isdir() else 'file' if member.isfile() else 'symlink' if member.issym() else 'hardlink' if member.islnk() else 'unsupported'
                                self.member(member.name, member.size, kind, members.extractfile(member) if member.isfile() else None,
                                            member.linkname, member.mode)
                        padding = 0
                        while chunk := stream.read(1024 * 1024):
                            padding += len(chunk)
                            require(padding <= 16 * 1024 ** 2, 'preparation-archive')
                        if process is not None:
                            process.wait(timeout=2)
                    finally:
                        stream.close()
                        if process is not None and process.poll() is None:
                            process.terminate()
                            try:
                                process.wait(timeout=2)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                process.wait(timeout=2)
                    require(process is None or process.returncode == 0, 'preparation-archive')
                    data.unlink()
                else:
                    archive.seek(size, 1)
                archive.seek(size % 2, 1)
            require(found, 'preparation-archive')

    def zip(self, path):
        with zipfile.ZipFile(path) as archive:
            for member in archive.infolist():
                mode = member.external_attr >> 16
                require(mode & 0o170000 in (0, 0o100000, 0o040000, 0o120000), 'preparation-archive')
                kind = 'directory' if member.is_dir() else 'symlink' if mode & 0o170000 == 0o120000 else 'file'
                with archive.open(member) as stream:
                    link = stream.read(4097).decode() if kind == 'symlink' else None
                    require(link is None or len(link) <= 4096, 'preparation-archive')
                    self.member(member.filename, member.file_size, kind, stream, link, mode)


def verify_index(release, data, relative):
    require('SHA256:\n' in release, 'preparation-index')
    rows = [line.split() for line in release.split('SHA256:\n', 1)[1].splitlines()]
    matched = [row for row in rows if len(row) == 3 and row[2] == relative]
    require(len(matched) == 1 and int(matched[0][1]) == len(data) and matched[0][0] == hashlib.sha256(data).hexdigest(), 'preparation-index')

def verify_package(index, item):
    for stanza in index.split('\n\n'):
        fields = dict(line.split(': ', 1) for line in stanza.splitlines() if line and not line[0].isspace() and ': ' in line)
        if fields.get('Package') == item['name'] and fields.get('Version') == item['version']:
            require(fields.get('Architecture') in ('amd64', 'all') and fields.get('Filename') == item['file'] and
                    fields.get('SHA256') == item['sha256'] and fields.get('Size') == str(item['bytes']), 'preparation-index')
            return
    raise PreparationRefusal('preparation-index')


def compiler_version(output):
    version = re.search(r'clang version (\d+)\.(\d+)\.(\d+)', output)
    require(version and tuple(map(int, version.groups()[:2])) >= (21, 1), 'preparation-prerequisite')
    return '.'.join(version.groups())

def loader_ready(output):
    require('not found' not in output, 'preparation-prerequisite')

def includes_ready(flags, prefix):
    includes = [token[2:] for token in flags.split() if token.startswith('-I')]
    require(bool(includes) and all(Path(path).is_relative_to(prefix) and Path(path).is_dir() for path in includes), 'preparation-prerequisite')


def prepare(root, source, deadline, progress=lambda step: None):
    progress('identity')
    require(platform.machine() == 'x86_64' and platform.system() == 'Linux', 'preparation-identity')
    os_release = Path('/etc/os-release').read_text()
    require(re.search(r'^ID=ubuntu$', os_release, re.M) and re.search(r'^VERSION_ID="24.04"$', os_release, re.M), 'preparation-identity')
    require(platform.libc_ver()[0] == 'glibc' and tuple(map(int, platform.libc_ver()[1].split('.')[:2])) >= (2, 38), 'preparation-identity')
    require(all(shutil.which(tool) for tool in ('gpg', 'gpgv', 'zstd', 'pkg-config', 'ldd', 'cc', 'make')), 'preparation-prerequisite')
    work = root / 'preparation'
    work.mkdir()
    cache, prefix, home = work / 'payloads', work / 'prefix', work / 'verify'
    cache.mkdir()
    home.mkdir(mode=0o700)
    acquisition = Acquisition(cache, deadline)
    manifest = json.loads(Path(__file__).with_name('preparation-manifest.json').read_text())
    indices = {}
    for name, repo in manifest['repositories'].items():
        progress('metadata-' + name)
        key = acquisition.fetch(repo['key'])
        release = acquisition.fetch(repo['release'])
        if repo['armoredKey']:
            binary = home / (name + '.gpg')
            checked(['gpg', '--batch', '--no-options', '--homedir', str(home), '--dearmor', '--output', str(binary), str(key)], category='preparation-signature')
            key = binary
        arguments = ['gpgv', '--homedir', str(home), '--keyring', str(key)]
        if 'signature' in repo:
            arguments += [str(acquisition.fetch(repo['signature']))]
        checked(arguments + [str(release)], category='preparation-signature')
        compressed = acquisition.fetch(repo['index']).read_bytes()
        verify_index(release.read_text(), compressed, repo['indexPath'])
        indices[name] = gzip.decompress(compressed).decode()
    extraction = Extraction(prefix)
    for item in manifest['packages']:
        progress('package-' + item['name'])
        verify_package(indices[item['repo']], item)
        payload = acquisition.fetch(dict(url=manifest['repositories'][item['repo']]['base'] + '/' + item['file'], bytes=item['bytes'], sha256=item['sha256']))
        extraction.deb(payload, cache)
    progress('artifact')
    artifact = manifest['artifact']
    archive = acquisition.fetch(artifact)
    extraction.zip(archive)
    extraction.finish()
    vendor = prefix / artifact['root']
    header = vendor / 'include/third_party/libc++/src/include/__configuration/compiler.h'
    require(hashlib.sha256(header.read_bytes()).hexdigest() == artifact['compilerHeaderSha256'] and
            (vendor / 'include/third_party/libc++/src/include/span').is_file(), 'preparation-prerequisite')
    environment = dict(os.environ, PATH=str(prefix / 'usr/bin') + ':' + os.environ['PATH'],
                       CXX=str(prefix / 'usr/bin/clang++-21'), PROTOC=str(prefix / 'usr/bin/protoc'),
                       LIBCLANG_PATH=str(prefix / 'usr/lib/llvm-21/lib'),
                       LD_LIBRARY_PATH=str(prefix / 'usr/lib/x86_64-linux-gnu') + ':' + str(prefix / 'usr/lib/llvm-21/lib'),
                       PKG_CONFIG_SYSROOT_DIR=str(prefix),
                       PKG_CONFIG_LIBDIR=str(prefix / 'usr/lib/x86_64-linux-gnu/pkgconfig') + ':' + str(prefix / 'usr/share/pkgconfig'),
                       LK_CUSTOM_WEBRTC=str(vendor))
    for label, executable in (('clang', environment['CXX']), ('protoc', environment['PROTOC']), ('libclang', str(prefix / 'usr/lib/x86_64-linux-gnu/libclang-21.so.21'))):
        progress('loader-' + label)
        output = checked(['ldd', executable], env=environment)
        if 'not found' in output:
            print('error: loader dependency missing: ' + output[-4096:], flush=True)
            loader_ready(output)
    progress('compiler')
    compiler = checked([environment['CXX'], '--version'], env=environment)
    version = compiler_version(compiler)
    progress('protoc')
    protoc = checked([environment['PROTOC'], '--version'], env=environment)
    require(protoc == 'libprotoc 3.21.12', 'preparation-prerequisite')
    progress('libclang')
    probe = "import ctypes,sys; p=ctypes.CDLL(sys.argv[1]); p.clang_createIndex.argtypes=[ctypes.c_int,ctypes.c_int]; p.clang_createIndex.restype=ctypes.c_void_p; p.clang_disposeIndex.argtypes=[ctypes.c_void_p]; i=p.clang_createIndex(0,0); assert i; p.clang_disposeIndex(i); print('libclang-load-ok')"
    require(checked(['/usr/bin/python3', '-B', '-c', probe, str(prefix / 'usr/lib/x86_64-linux-gnu/libclang-21.so.21')], env=environment) == 'libclang-load-ok', 'preparation-prerequisite')
    progress('proto-imports')
    protocol = source / 'livekit-ffi/protocol'
    protos = sorted(str(path) for path in protocol.glob('*.proto'))
    require(bool(protos), 'preparation-prerequisite')
    checked([environment['PROTOC'], '-I', str(protocol), '--descriptor_set_out=' + str(work / 'imports.pb'), *protos], env=environment)
    for library in ('glib-2.0', 'gobject-2.0', 'gio-2.0'):
        progress('pkg-' + library.replace('.', '-'))
        flags = checked(['pkg-config', '--cflags', '--libs', library], env=environment)
        includes_ready(flags, prefix)
    progress('headers')
    require(all((prefix / path).is_file() for path in ('usr/include/glib-2.0/glib.h', 'usr/include/glib-2.0/glib-object.h', 'usr/include/glib-2.0/gio/gio.h')), 'preparation-prerequisite')
    require(Path('/usr/include/stdio.h').is_file() and Path('/usr/lib/x86_64-linux-gnu/crt1.o').is_file(), 'preparation-prerequisite')
    progress('crt')
    crt = checked([environment['CXX'], '-print-file-name=crtbeginS.o'], env=environment)
    require(Path(crt).is_absolute() and Path(crt).is_file(), 'preparation-prerequisite')
    cargo_window(deadline)
    return environment, dict(downloadBytes=acquisition.bytes, expandedLogicalBytes=extraction.bytes,
                            compilerVersion=version, protocVersion='3.21.12',
                            signaturesVerified=True, libclangLoaded=True, importsAccepted=True, pkgConfigAccepted=True)
