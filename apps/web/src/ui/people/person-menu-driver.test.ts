import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createPersonMenuDriver,
  personMenuOn,
  personMenuStart,
  type PersonMenuEvent,
} from './person-menu-driver';

setupRitewayBun();

const walk = (events: readonly PersonMenuEvent[]) =>
  events.reduce(personMenuOn, personMenuStart);

describe('person menu driver', () => {
  test('each view starts fresh', () => {
    assert({
      given: 'the challenge view entered twice, for ranked and casual takers',
      should: 'start at the mode the person takes, and forget a change on back',
      actual: [
        walk([{ type: 'challenge', ranked: true }]),
        walk([{ type: 'challenge', ranked: false }]),
        walk([
          { type: 'challenge', ranked: true },
          { type: 'mode', mode: 'casual' },
          { type: 'menu' },
          { type: 'challenge', ranked: true },
        ]),
        walk([
          { type: 'report' },
          { type: 'reason', reason: 'spam' },
          { type: 'menu' },
          { type: 'report' },
        ]),
      ],
      expected: [
        { view: 'challenge', mode: 'ranked' },
        { view: 'challenge', mode: 'casual' },
        { view: 'challenge', mode: 'ranked' },
        { view: 'report', reason: null },
      ],
    });
  });

  test('a choice belongs to its own view', () => {
    const report = walk([{ type: 'report' }]);
    const challenge = walk([{ type: 'challenge', ranked: true }]);
    assert({
      given:
        'a mode chosen in the report view, a reason in the challenge view, and a view opened from another',
      should: 'change nothing',
      actual: [
        personMenuOn(report, { type: 'mode', mode: 'casual' }) === report,
        personMenuOn(challenge, { type: 'reason', reason: 'spam' }) ===
          challenge,
        personMenuOn(report, { type: 'challenge', ranked: true }) === report,
        personMenuOn(challenge, { type: 'report' }) === challenge,
        personMenuOn(personMenuStart, { type: 'mode', mode: 'casual' }),
      ],
      expected: [true, true, true, true, personMenuStart],
    });
  });

  test('the driver tells its view only of real changes', () => {
    const driver = createPersonMenuDriver();
    let changes = 0;
    driver.subscribe(() => changes++);
    driver.send({ type: 'mode', mode: 'casual' });
    driver.send({ type: 'report' });
    driver.send({ type: 'reason', reason: 'spam' });
    driver.send({ type: 'reason', reason: 'spam' });
    const snapshot = driver.readSnapshot();
    driver.dispose();
    driver.send({ type: 'menu' });
    assert({
      given: 'an ignored choice, a view, a reason twice, then dispose',
      should: 'publish two changes and hear nothing after dispose',
      actual: { changes, snapshot },
      expected: { changes: 2, snapshot: { view: 'report', reason: 'spam' } },
    });
  });
});
