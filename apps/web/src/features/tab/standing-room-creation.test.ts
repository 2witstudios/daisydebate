import { assert, setupRitewayBun, test } from 'riteway/bun';
import { plainRoomConfig } from '@daisy/protocol/testing';
import { standingRoomCreationSchema } from './standing-room-creation';
setupRitewayBun();
test('standing Room metadata validates exact resolved creation inputs', () => {
  const value = {
    selection: {
      kind: 'catalog',
      formatId: 'freestyle',
      formatVersion: 1,
      presetVersion: 2,
      competitionType: 'casual',
    },
    config: plainRoomConfig,
    resolutionChoicePolicy: { method: 'fixed', ownText: true, choices: [] },
    rating: { kind: 'unrated' },
    visibility: { value: 'unlisted', locked: true },
  };
  assert({
    given: 'actual resolved catalogue pins/config and explicit source policy',
    should: 'accept the complete creation read',
    actual: standingRoomCreationSchema.safeParse(value).success,
    expected: true,
  });
  assert({
    given: 'metadata missing its pinned preset revision',
    should: 'refuse rather than adopt a current or fabricated default',
    actual: standingRoomCreationSchema.safeParse({
      ...value,
      selection: { ...value.selection, presetVersion: undefined },
    }).success,
    expected: false,
  });
});
