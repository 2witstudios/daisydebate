import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

test('fixed-pin source admission refuses missing, altered and wrong-identity inputs before Cargo', () => {
  const source = `import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
sys.path.insert(0,'packages/media/integration/native-owner-compile')
from source_inputs import SourceRefusal,verify_checkout,verify_gitlink
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory)
    def git(*args):
        return subprocess.check_output(['git','-c','user.name=Source Control','-c','user.email=source@example.invalid','-c','commit.gpgsign=false',*args],cwd=root,text=True,stderr=subprocess.DEVNULL).strip()
    git('init','--quiet')
    content=b'fixed source input'
    target=root/'required.sql'
    target.write_bytes(content)
    git('add','required.sql')
    git('commit','--quiet','-m','source fixture')
    pin=git('rev-parse','HEAD')
    blob=hashlib.sha1(f'blob {len(content)}\\0'.encode()+content).hexdigest()
    inputs=(('required.sql',blob),)
    admitted=[]
    def admission():
        verify_checkout(root,pin,inputs)
        admitted.append('cargo-admissible')
    def outcome(action):
        try:
            action()
            return 'accepted'
        except SourceRefusal as error:
            return str(error)
    healthy=outcome(admission)
    target.unlink()
    missing=outcome(admission)
    target.write_bytes(b'changed source input')
    altered=outcome(admission)
    target.write_bytes(content)
    wrong_head=outcome(lambda:verify_checkout(root,'0'*40,inputs))
    git('update-index','--add','--cacheinfo',f'160000,{pin},vendor')
    git('commit','--quiet','-m','gitlink fixture')
    link=outcome(lambda:verify_gitlink(root,'vendor',pin))
    wrong_link=outcome(lambda:verify_gitlink(root,'vendor','0'*40))
    absent_link=outcome(lambda:verify_gitlink(root,'absent',pin))
    print(json.dumps(dict(healthy=healthy,missing=missing,altered=altered,wrongHead=wrong_head,link=link,wrongLink=wrong_link,absentLink=absent_link,cargoAdmissions=len(admitted))))`;
  const child = Bun.spawnSync(['python3', '-B', '-c', source]);
  if (child.exitCode !== 0) throw new Error('Source admission control failed');
  assert({
    given:
      'actual git commits and a recorded gitlink, then missing/modified files or mismatched identities',
    should:
      'admit only the complete fixed source and refuse each bad input before Cargo',
    actual: JSON.parse(child.stdout.toString()),
    expected: {
      healthy: 'accepted',
      missing: 'source-input-missing',
      altered: 'source-blob-mismatch',
      wrongHead: 'source-head-mismatch',
      link: 'accepted',
      wrongLink: 'source-gitlink-mismatch',
      absentLink: 'source-gitlink-mismatch',
      cargoAdmissions: 1,
    },
  });
});
