import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideRoomResolution } from './room-resolution';

setupRitewayBun();

describe('decideRoomResolution', () => {
  test('the Freestyle standard strikes', () => {
    assert({
      given: 'a Strike selection on the Freestyle standard, whose rules strike',
      should: 'start with no topic until the reveal',
      actual: decideRoomResolution({
        selection: { kind: 'strike' },
        standard: true,
        strikes: true,
      }),
      expected: { ok: true, topic: null },
    });
  });
  test('standard and Custom methods', () => {
    const input = {
      selection: { kind: 'custom' as const, text: 'A host resolution' },
      strikes: false,
    };
    assert({
      given:
        'custom wording submitted as a standard, as Custom, and against strike settings',
      should: 'accept only the Custom fixed-resolution request',
      actual: [
        decideRoomResolution({ ...input, standard: true }).ok,
        decideRoomResolution({ ...input, standard: false }),
        decideRoomResolution({ ...input, standard: false, strikes: true }).ok,
      ],
      expected: [
        false,
        { ok: true, topic: 'A host resolution' },
        false,
      ],
    });
  });
  test('a strike without strike rules', () => {
    assert({
      given: 'a Strike selection on Custom rules that do not strike',
      should: 'refuse instead of guessing a resolution',
      actual: decideRoomResolution({
        selection: { kind: 'strike' },
        standard: false,
        strikes: false,
      }).ok,
      expected: false,
    });
  });
});
