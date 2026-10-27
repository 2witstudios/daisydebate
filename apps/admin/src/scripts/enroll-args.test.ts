import { assert, setupRitewayBun, test } from 'riteway/bun';
import { parseEnrollArgs } from './enroll-args';

setupRitewayBun();
test('parseEnrollArgs', () => {
  assert({
    given: 'a name alone, with --additional and with --replace',
    should: 'select the initial, additional and replace modes',
    actual: [
      parseEnrollArgs(['--name', 'owner']),
      parseEnrollArgs(['--name', 'owner', '--additional']),
      parseEnrollArgs(['--name', 'owner', '--replace']),
    ],
    expected: [
      { ok: true, name: 'owner', mode: 'initial' },
      { ok: true, name: 'owner', mode: 'additional' },
      { ok: true, name: 'owner', mode: 'replace' },
    ],
  });
  assert({
    given: 'no name, both modes, an unknown flag or a control character',
    should: 'refuse each with the usage line',
    actual: [
      [],
      ['--name', 'owner', '--replace', '--additional'],
      ['--name', 'owner', '--force'],
      ['--name', 'own\ner'],
    ].map((argv) => parseEnrollArgs(argv).ok),
    expected: [false, false, false, false],
  });
});
