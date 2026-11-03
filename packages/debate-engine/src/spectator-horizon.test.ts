import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { factReleased, RANKED_DELAY_SECONDS } from './broadcast-release';
import {
  spectatorHorizon,
  spectatorTimelineHorizon,
  type SpectatorHorizonFacts,
} from './spectator-horizon';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';

setupRitewayBun();

const now = 10_000_000;
const delay = { kind: 'delay', seconds: RANKED_DELAY_SECONDS } as const;
const delayMs = RANKED_DELAY_SECONDS * 1000;
const open = {
  policy: delay,
  releasedThroughMs: 9_000_000,
  completedAtMs: null,
  stoppedAtMs: null,
};
const facts = (
  over: Partial<SpectatorHorizonFacts>,
): SpectatorHorizonFacts => ({
  nowMs: now,
  competitionType: 'ranked',
  roundTerminal: false,
  broadcast: open,
  ...over,
});
const visible = (capturedAtMs: number, over: Partial<SpectatorHorizonFacts>) =>
  factReleased(capturedAtMs, spectatorHorizon(facts(over)), {
    marginMs: SPECTATOR_MARGIN_MS,
  });

describe('spectatorHorizon', () => {
  test('an open Broadcast follows its watermark, never the clock', () => {
    assert({
      given: 'an open Broadcast whose watermark is far behind the clock',
      should: 'be the watermark',
      actual: spectatorHorizon(facts({})),
      expected: 9_000_000,
    });
    assert({
      given: 'an open Broadcast with no media out, long after the fact',
      should: 'release nothing',
      actual: visible(1000, {
        roundTerminal: true,
        broadcast: { ...open, releasedThroughMs: null },
      }),
      expected: false,
    });
  });

  test('the margin holds a fact past the watermark', () => {
    assert({
      given: 'a fact captured just inside the margin of the watermark',
      should: 'stay withheld',
      actual: visible(9_000_000 - SPECTATOR_MARGIN_MS + 1, {}),
      expected: false,
    });
    assert({
      given: 'a fact the watermark has passed by the margin',
      should: 'be released',
      actual: visible(9_000_000 - SPECTATOR_MARGIN_MS, {}),
      expected: true,
    });
  });

  test('a finished Broadcast keeps the delay as a floor', () => {
    for (const finished of [{ completedAtMs: now }, { stoppedAtMs: now }]) {
      const broadcast = { ...open, ...finished, releasedThroughMs: null };
      assert({
        given: 'a finished Broadcast and a fact younger than the delay',
        should: 'withhold it',
        actual: visible(now - delayMs + 1, { broadcast }),
        expected: false,
      });
      assert({
        given: 'a finished Broadcast and a fact as old as the delay',
        should: 'release it, since no more media will ever pass it',
        actual: visible(now - delayMs, { broadcast }),
        expected: true,
      });
    }
  });

  test('a finished Broadcast never moves its watermark back', () => {
    assert({
      given: 'a finished Broadcast whose watermark is ahead of the floor',
      should: 'keep the watermark',
      actual: spectatorHorizon(
        facts({
          broadcast: {
            ...open,
            stoppedAtMs: now,
            releasedThroughMs: now + 500_000,
          },
        }),
      ),
      expected: now + 500_000,
    });
  });

  test('a stopped scheduled release still waits for its own time', () => {
    const stopped = { ...open, stoppedAtMs: now, releasedThroughMs: null };
    assert({
      given: 'a stopped round-end release while the Round runs',
      should: 'release nothing',
      actual: spectatorHorizon(
        facts({
          competitionType: 'casual',
          broadcast: { ...stopped, policy: { kind: 'round_end' } },
        }),
      ),
      expected: null,
    });
    assert({
      given: 'a stopped round-end release once the Round ended',
      should: 'release what was captured',
      actual: visible(now, {
        competitionType: 'casual',
        roundTerminal: true,
        broadcast: { ...stopped, policy: { kind: 'round_end' } },
      }),
      expected: true,
    });
    assert({
      given: 'a stopped set-time release before its time',
      should: 'release nothing',
      actual: spectatorHorizon(
        facts({
          competitionType: 'casual',
          broadcast: { ...stopped, policy: { kind: 'at', atMs: now + 1 } },
        }),
      ),
      expected: null,
    });
    assert({
      given: 'a stopped set-time release at its time',
      should: 'release what was captured',
      actual: visible(now, {
        competitionType: 'casual',
        broadcast: { ...stopped, policy: { kind: 'at', atMs: now } },
      }),
      expected: true,
    });
  });

  test('no Broadcast: live facts stay private on every Round', () => {
    for (const competitionType of ['ranked', 'casual'] as const)
      assert({
        given: `a live ${competitionType} Round with no Broadcast`,
        should: 'release nothing',
        actual: spectatorHorizon(facts({ competitionType, broadcast: null })),
        expected: null,
      });
  });

  test('no Broadcast: an ended Round releases, ranked behind the fixed floor', () => {
    assert({
      given: 'an ended casual Round with no Broadcast',
      should: 'release at once, as nothing holds it',
      actual: visible(now, {
        competitionType: 'casual',
        roundTerminal: true,
        broadcast: null,
      }),
      expected: true,
    });
    assert({
      given: 'a ranked Round that ended inside the delay with no Broadcast',
      should: 'withhold its facts',
      actual: visible(now - delayMs + 1, {
        roundTerminal: true,
        broadcast: null,
      }),
      expected: false,
    });
    assert({
      given: 'a ranked Round that ended the delay ago with no Broadcast',
      should: 'release its facts',
      actual: visible(now - delayMs, { roundTerminal: true, broadcast: null }),
      expected: true,
    });
  });
});

describe('spectatorTimelineHorizon', () => {
  test('a stop ends the timeline where the watermark stood', () => {
    const stopped = { ...open, stoppedAtMs: now };
    assert({
      given: 'a stopped Broadcast, long after by the clock',
      should: 'stay at its watermark, so no fact appears after the stop',
      actual: spectatorTimelineHorizon(
        facts({ nowMs: now * 2, roundTerminal: true, broadcast: stopped }),
      ),
      expected: open.releasedThroughMs,
    });
    assert({
      given: 'a Broadcast stopped before any media left',
      should: 'release nothing, ever',
      actual: spectatorTimelineHorizon(
        facts({
          nowMs: now * 2,
          roundTerminal: true,
          broadcast: { ...stopped, releasedThroughMs: null },
        }),
      ),
      expected: null,
    });
  });

  test('anything but a stop reads the shared horizon', () => {
    const completed = { ...open, completedAtMs: now };
    for (const over of [
      {},
      { broadcast: null, roundTerminal: true },
      { broadcast: completed, roundTerminal: true },
    ])
      assert({
        given: 'no stop',
        should: 'equal the shared horizon',
        actual: spectatorTimelineHorizon(facts(over)),
        expected: spectatorHorizon(facts(over)),
      });
  });
});
