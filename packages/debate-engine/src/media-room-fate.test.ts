import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mediaRoomFate } from './media-room-fate';

setupRitewayBun();

const bound = 6_000;
const rule = mediaRoomFate(bound);
const nowMs = 100_000;
const sound = {
  nowMs,
  terminal: false,
  ended: false,
  absenceProven: false,
  seatRevoked: false,
  uncertainSinceMs: null,
  lastOccupiedSid: null,
  sawCapture: false,
  seen: null,
};

test('a room is settled by observed absence, or by uncertainty outlasting the bound', () => {
  const cases = [
    ['nothing uncertain', sound, 'keep'],
    [
      'a blip under the bound',
      { ...sound, uncertainSinceMs: nowMs - bound + 1 },
      'keep',
    ],
    [
      'a silent room at the bound',
      { ...sound, uncertainSinceMs: nowMs - bound },
      'rotate:unreachable',
    ],
    [
      'an uncertain room seen absent',
      { ...sound, absenceProven: true, uncertainSinceMs: nowMs },
      'rotate:absent',
    ],
    [
      'a revoked seat, room seen absent',
      { ...sound, absenceProven: true, seatRevoked: true },
      'rotate:seat-revoked',
    ],
    [
      'a revoked seat, room still there',
      { ...sound, seatRevoked: true },
      'keep',
    ],
    ['a sound room seen absent', { ...sound, absenceProven: true }, 'clear'],
    [
      'terminal, silent past the bound',
      { ...sound, terminal: true, uncertainSinceMs: 0 },
      'keep',
    ],
    [
      'terminal, seen absent',
      { ...sound, terminal: true, absenceProven: true, uncertainSinceMs: 0 },
      'end',
    ],
    [
      'already ended, silent past the bound',
      { ...sound, ended: true, uncertainSinceMs: 0 },
      'keep',
    ],
    [
      'already ended, seen absent',
      { ...sound, ended: true, absenceProven: true },
      'clear',
    ],
  ] as const;
  for (const [given, facts, expected] of cases) {
    const fate = rule(facts);
    assert({
      given,
      should: `be ${expected}`,
      actual: fate.kind === 'rotate' ? `rotate:${fate.cause}` : fate.kind,
      expected,
    });
  }
});
