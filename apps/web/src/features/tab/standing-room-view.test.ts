import { assert, setupRitewayBun, test } from 'riteway/bun';
import { plainRoomConfig } from '@daisy/protocol/testing';
import type { StandingRoomCreation } from './standing-room-creation';
import { standingRoomUnavailableReason } from './standing-room-view';
setupRitewayBun();
test('standing Room availability uses actual pool and rating eligibility', () => {
  const creation: StandingRoomCreation = {
    selection: {
      kind: 'catalog',
      formatId: 'freestyle',
      formatVersion: 1,
      presetVersion: 1,
      competitionType: 'casual',
    },
    config: plainRoomConfig,
    visibility: { value: 'public', locked: false },
    recording: { value: 'off', locked: false },
    rating: { kind: 'unrated' },
    resolutionChoicePolicy: { method: 'fixed', ownText: false, choices: [] },
  };
  assert({
    given: 'fixed pool without available wording or own text',
    should: 'make creation unavailable truthfully',
    actual: standingRoomUnavailableReason(creation),
    expected: 'No resolutions are available.',
  });
  assert({
    given: 'a strike source with one actual choice',
    should: 'refuse to fabricate enough choices',
    actual: standingRoomUnavailableReason({
      ...creation,
      resolutionChoicePolicy: {
        method: 'strike',
        ownText: false,
        choices: [{ id: 'choice', text: 'Actual wording' }],
      },
    }),
    expected: 'There are not enough resolutions in the pool.',
  });
  assert({
    given: 'an unsupported rating format',
    should: 'make creation unavailable',
    actual: standingRoomUnavailableReason({
      ...creation,
      rating: { kind: 'unsupported' },
    }),
    expected: 'This format is unavailable on the league ladder.',
  });
});
