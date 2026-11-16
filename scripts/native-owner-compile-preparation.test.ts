import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

test('scratch preparation refuses unsafe archives, changed provenance and insufficient Cargo time', () => {
  const source = `import hashlib,io,json,lzma,sys,tarfile,tempfile,zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,'packages/media/integration/native-owner-compile')
from preparation import Extraction,PreparationRefusal,verify_index,verify_package,cargo_window,Acquisition
with tempfile.TemporaryDirectory() as directory:
    base=Path(directory)
    def outcome(action):
        try:
            action()
            return 'accepted'
        except PreparationRefusal as error:
            return str(error)
    def extract(name,kind='file',link=None):
        root=base/str(len(list(base.iterdir())))
        x=Extraction(root)
        x.member(name,1 if kind=='file' else 0,kind,io.BytesIO(b'x'),link)
        x.finish()
    traversal=outcome(lambda:extract('../outside'))
    absolute=outcome(lambda:extract('/outside'))
    symlink=outcome(lambda:extract('link','symlink','../../outside'))
    hardlink=outcome(lambda:extract('link','hardlink','../outside'))
    def redirect():
        x=Extraction(base/'redirect')
        x.member('a',0,'symlink',link='.')
        x.member('b',0,'symlink',link='a/..')
        x.finish()
    redirect_result=outcome(redirect)
    def valid_deb():
        output=io.BytesIO()
        with tarfile.open(fileobj=output,mode='w') as t:
            root=tarfile.TarInfo('./');root.type=tarfile.DIRTYPE;t.addfile(root)
            item=tarfile.TarInfo('./usr/bin/tool');item.size=4;item.mode=0o6755;t.addfile(item,io.BytesIO(b'data'))
            link=tarfile.TarInfo('./usr/bin/alias');link.type=tarfile.SYMTYPE;link.linkname='tool';t.addfile(link)
        data=lzma.compress(output.getvalue())
        header=f"{'data.tar.xz/':<16}{0:<12}{0:<6}{0:<6}{'100644':<8}{len(data):<10}\\x60\\n".encode()
        archive=base/'fixture.deb';archive.write_bytes(b'!<arch>\\n'+header+data+(b'\\n' if len(data)%2 else b''))
        x=Extraction(base/'valid');x.deb(archive,base);x.finish()
        path=base/'valid/usr/bin/tool'
        return path.read_bytes()==b'data' and path.stat().st_mode&0o7777==0o755 and (base/'valid/usr/bin/alias').read_bytes()==b'data'
    valid=valid_deb()
    data=b'Package: a\\nVersion: 1\\nArchitecture: amd64\\nFilename: pool/a.deb\\nSize: 1\\nSHA256: abc\\n'
    release='SHA256:\\n '+hashlib.sha256(data).hexdigest()+' '+str(len(data))+' main/Packages\\n'
    good_index=outcome(lambda:verify_index(release,data,'main/Packages'))
    bad_index=outcome(lambda:verify_index(release,data+b'x','main/Packages'))
    item=dict(name='a',version='1',file='pool/a.deb',bytes=1,sha256='abc')
    good_package=outcome(lambda:verify_package(data.decode(),item))
    bad_package=outcome(lambda:verify_package(data.decode(),dict(item,sha256='changed')))
    missing_package=outcome(lambda:verify_package(data.decode(),dict(item,name='missing')))
    with patch('preparation.remaining',return_value=59):
        short=outcome(lambda:cargo_window(0))
    with patch('preparation.remaining',return_value=60):
        boundary=outcome(lambda:cargo_window(0))
    class Response(io.BytesIO):
        def geturl(self):return 'https://example.invalid/data'
    payload=b'package data'
    expected=dict(url='https://example.invalid/data',bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest())
    with patch('preparation.remaining',return_value=100),patch('preparation.urllib.request.urlopen',return_value=Response(payload)):
        acquisition=Acquisition(base,0)
        good_download=outcome(lambda:acquisition.fetch(expected))
    with patch('preparation.remaining',return_value=100),patch('preparation.urllib.request.urlopen',return_value=Response(payload+b'changed')):
        bad_download=outcome(lambda:Acquisition(base,0).fetch(expected))
    print(json.dumps(dict(traversal=traversal,absolute=absolute,symlink=symlink,hardlink=hardlink,redirect=redirect_result,valid=valid,goodIndex=good_index,badIndex=bad_index,goodPackage=good_package,badPackage=bad_package,missingPackage=missing_package,short=short,boundary=boundary,goodDownload=good_download,badDownload=bad_download,outsideWritten=(base.parent/'outside').exists())))`;
  const child = Bun.spawnSync(['python3', '-B', '-c', source]);
  if (child.exitCode !== 0) throw new Error('Preparation control failed');
  assert({
    given:
      'synthetic package archives, exact signed-index records, payload mutations and a short window',
    should:
      'preserve safe files and links while refusing unsafe extraction or incomplete preparation before Cargo',
    actual: JSON.parse(child.stdout.toString()),
    expected: {
      traversal: 'preparation-archive',
      absolute: 'preparation-archive',
      symlink: 'preparation-archive',
      hardlink: 'preparation-archive',
      redirect: 'preparation-archive',
      valid: true,
      goodIndex: 'accepted',
      badIndex: 'preparation-index',
      goodPackage: 'accepted',
      badPackage: 'preparation-index',
      missingPackage: 'preparation-index',
      short: 'insufficient-compile-window',
      boundary: 'accepted',
      goodDownload: 'accepted',
      badDownload: 'preparation-download',
      outsideWritten: false,
    },
  });
});

test('known compiler, loader and header gaps refuse prerequisite admission', () => {
  const source = `import json,sys,tempfile
from pathlib import Path
sys.path.insert(0,'packages/media/integration/native-owner-compile')
from preparation import PreparationRefusal,compiler_version,loader_ready,includes_ready,checked
with tempfile.TemporaryDirectory() as directory:
    prefix=Path(directory);(prefix/'include').mkdir()
    def outcome(action):
        try:
            action()
            return 'accepted'
        except PreparationRefusal as error:
            return str(error)
    values=[outcome(lambda:compiler_version('Ubuntu clang version 18.1.3')),outcome(lambda:compiler_version('clang version 21.0.0')),outcome(lambda:compiler_version('clang version 21.1.8')),outcome(lambda:compiler_version('unrecognized')),
            outcome(lambda:loader_ready('libLLVM.so.21.1 => not found')),outcome(lambda:loader_ready('libLLVM.so.21.1 => /scratch/libLLVM.so.21.1')),
            outcome(lambda:includes_ready('-I/usr/include',prefix)),outcome(lambda:includes_ready('-I'+str(prefix/'missing'),prefix)),outcome(lambda:includes_ready('-I'+str(prefix/'include'),prefix)),outcome(lambda:checked([sys.executable,'-c','raise SystemExit(1)']))]
    print(json.dumps(values))`;
  const child = Bun.spawnSync(['python3', '-B', '-c', source]);
  if (child.exitCode !== 0) throw new Error('Prerequisite control failed');
  const lines = child.stdout.toString().trim().split('\n');
  assert({
    given:
      'Clang18 or21.0, an absent loader dependency, escaped/missing includes or a failed executable',
    should: 'refuse every incomplete case and accept only the qualified cases',
    actual: JSON.parse(lines.at(-1)!),
    expected: [
      'preparation-prerequisite',
      'preparation-prerequisite',
      'accepted',
      'preparation-prerequisite',
      'preparation-prerequisite',
      'accepted',
      'preparation-prerequisite',
      'preparation-prerequisite',
      'accepted',
      'preparation-prerequisite',
    ],
  });
});
