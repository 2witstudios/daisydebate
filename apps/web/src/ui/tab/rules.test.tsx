import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { DrawBoard } from '../../features/tab/draw';
import { stageHeading } from './bracket/bracket';
import { draftSummary } from './draw-board/draw-board';
import { slotClass } from './host-entries/host-judges';
import { speakerStatus } from './live-section/live-section';
import { attentionHeading } from './running-round/attention-list';
import { forceLabel } from './setup/setup';
import { seatMarkClass } from './waiting-room/waiting-room';

setupRitewayBun();

describe('Tab screen labels', () => {
  test('a draft draw says what it cost', () => {
    const draw = {
      version: 3,
      basis: 'from results through round 3',
      rulesBroken: 0,
      preferencesBent: 1,
    } as DrawBoard;
    assert({
      given:
        'a draft with no rule broken and one preference bent, and one with two rules broken',
      should: 'name the version, the basis and each count in words',
      actual: [
        draftSummary(draw),
        draftSummary({ ...draw, rulesBroken: 2, preferencesBent: 0 }),
      ],
      expected: [
        'Draft 3 · from results through round 3 · no rules broken · 1 preference bent',
        'Draft 3 · from results through round 3 · 2 rules broken · no preferences bent',
      ],
    });
  });

  test('a policy shows its force', () => {
    const policy = { key: 'k', label: 'l' };
    assert({
      given: 'a rule, a ranked preference, a warning and a policy that is off',
      should: 'say how hard the engine tries',
      actual: [
        forceLabel({ ...policy, force: 'rule', rank: null }),
        forceLabel({ ...policy, force: 'preference', rank: 2 }),
        forceLabel({ ...policy, force: 'warning', rank: null }),
        forceLabel({ ...policy, force: 'off', rank: null }),
      ],
      expected: ['Rule', 'Preference 2', 'Warning', 'Off'],
    });
  });

  test('headings carry state', () => {
    assert({
      given: 'a cut attention group, a whole one, a live stage and a timed one',
      should: 'add the count, the live mark or the time',
      actual: [
        attentionHeading({
          attention: 'finished',
          count: 20,
          rooms: [],
          more: null,
        }),
        attentionHeading({
          attention: 'needs_you',
          count: null,
          rooms: [],
          more: null,
        }),
        stageHeading({
          name: 'Semifinals',
          state: 'live',
          time: null,
          ties: [],
          note: null,
        }),
        stageHeading({
          name: 'Final',
          state: 'upcoming',
          time: '18:30',
          ties: [],
          note: null,
        }),
      ],
      expected: [
        'Finished · 20',
        'Needs you',
        'Semifinals · live',
        'Final · 18:30',
      ],
    });
  });

  test('only trouble takes a colour', () => {
    assert({
      given: 'a late judge, a judge in a Room and a free judge',
      should: 'mark the late one alone',
      actual: [slotClass('late'), slotClass('room'), slotClass('free')],
      expected: ['font-strong text-live', 'text-ink', 'text-ink-muted'],
    });
  });

  test('a speaker and a seat', () => {
    const speaker = { name: 'A', school: null, you: false };
    assert({
      given: 'a finished, a speaking and a waiting speaker, and a clay seat',
      should: 'show the time, the state or nothing, and the seat in its tone',
      actual: [
        speakerStatus({ ...speaker, state: 'done', time: '5:48' }),
        speakerStatus({ ...speaker, state: 'speaking', time: null }),
        speakerStatus({ ...speaker, state: 'waiting', time: null }),
        seatMarkClass('clay').endsWith('bg-hue-clay-soft text-hue-clay'),
      ],
      expected: ['5:48', 'speaking', null, true],
    });
  });
});
