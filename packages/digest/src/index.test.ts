import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { commandDigest, sha3Hex } from './index';

setupRitewayBun();

describe('SHA3-256', () => {
  test('matches the known answers for empty input and abc', () => {
    assert({
      given: 'empty text, ASCII text, and the same input as bytes',
      should: 'return lowercase SHA3-256 hex',
      actual: [sha3Hex(''), sha3Hex('abc'), sha3Hex(Uint8Array.of(97, 98, 99))],
      expected: [
        'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
        '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
        '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
      ],
    });
  });

  test('uses the published encoding of the command', () => {
    const payload = { title: 'Crème', version: 1 };
    assert({
      given:
        'a command payload with Unicode and a contract with a custom encoding',
      should: 'hash the UTF-8 bytes in the command format',
      actual: [commandDigest(payload), commandDigest(payload, () => 'abc')],
      expected: [
        'd232d1b91d4b333a152aff11b7b1ff68629dd0bdfbc1f2a186f6363d8480c9ee',
        '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
      ],
    });
  });
});
