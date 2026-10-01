import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTournament } from './get-tournament';
import { withdrawScreen } from './withdraw';

setupRitewayBun();

const screen = (id: string) => {
  const view = getTournament(id, true);
  if (!view) throw new Error(`no sample ${id}`);
  return withdrawScreen(view);
};

describe('withdrawScreen', () => {
  test('each standing has its own dialog', () => {
    assert({
      given:
        'registered before the bracket, waitlisted, registered after the bracket, not entered, competing',
      should:
        'name before-bracket, leave-waitlist, after-bracket with the opponent, and not-entered',
      actual: [
        screen('autumn-open'),
        screen('novice-cup'),
        screen('hollow-cup'),
        screen('weeknight-sprint'),
        screen('harvest-cup'),
      ],
      expected: [
        { kind: 'before-bracket' },
        { kind: 'leave-waitlist', position: 2 },
        { kind: 'after-bracket', opponent: 'debater-k' },
        { kind: 'not-entered' },
        { kind: 'not-entered' },
      ],
    });
  });
});
