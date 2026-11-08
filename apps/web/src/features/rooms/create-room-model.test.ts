import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { unequalTemplate } from './assembly.test-support';
import {
  changeRoomValue,
  chooseRoomChoice,
  initialRoomModel,
} from './create-room-model';

setupRitewayBun();

const choice = (formatId: string, label = formatId) => ({
  ...unequalTemplate,
  formatId,
  label,
  role: 'standard' as const,
});
const catalog = [choice('freestyle', 'Freestyle'), choice('policy', 'Policy')];
const freestyle = catalog[0]!;
const policy = catalog[1]!;

describe('the create-room model', () => {
  test('an edit and its revert both follow the decoded draft, not a forced format', () => {
    let model = initialRoomModel(policy, catalog, {}, false);
    assert({
      given: 'a Policy standard chosen',
      should: 'run the standard, not Custom',
      actual: [
        model.values.format,
        model.draft.custom,
        model.draft.basis.formatId,
      ],
      expected: ['policy', false, 'policy'],
    });
    model = changeRoomValue(model, 'resolutionMethod', 'strike', catalog);
    assert({
      given: 'the resolution changed away from the standard',
      should: 'decode as Custom while the basis stays Policy',
      actual: [
        model.draft.custom,
        model.draft.basis.formatId,
        model.draft.ranked,
      ],
      expected: [true, 'policy', false],
    });
    model = changeRoomValue(model, 'resolutionMethod', 'policy', catalog);
    assert({
      given: 'the edit reverted to the standard resolution',
      should: 'read as the Policy standard again',
      actual: [
        model.draft.custom,
        model.draft.basis.formatId,
        model.draft.ranked,
      ],
      expected: [false, 'policy', false],
    });
  });

  test('an invalid mid-edit value keeps the room custom and unranked', () => {
    const model = initialRoomModel(freestyle, catalog, {}, false);
    const broken = changeRoomValue(model, 'duration.preRound', 'abc', catalog);
    assert({
      given: 'a malformed duration typed into a standard draft',
      should: 'hold the custom state without decoding',
      actual: [broken.draft.custom, broken.draft.ranked],
      expected: [true, false],
    });
  });

  test('the editor opens on the catalog default with kept values re-read', () => {
    const kept = initialRoomModel(
      policy,
      catalog,
      { title: 'Kept', intent: 'format' },
      true,
    );
    assert({
      given: 'a refused native post carried back with a title and its intent',
      should:
        'keep the title, stay on the named format, and drop the consumed intent',
      actual: [kept.values.title, kept.values.format, kept.values.intent],
      expected: ['Kept', 'policy', ''],
    });
    const fresh = initialRoomModel(
      { ...policy, preset: { ...policy.preset, rankedEligible: true } },
      catalog,
      {},
      true,
    );
    assert({
      given: 'a ranked-eligible standard with no kept values',
      should: 'open ranked',
      actual: fresh.values.ranked,
      expected: 'on',
    });
  });

  test('a stale intent never resets the preset behind an edit', () => {
    let model = initialRoomModel(
      freestyle,
      catalog,
      { intent: 'format' },
      false,
    );
    assert({
      given: 'the editor reopened from a refused Apply format post',
      should: 'apply the next edit instead of resetting to the preset',
      actual: changeRoomValue(model, 'resolutionMethod', 'strike', catalog)
        .draft.custom,
      expected: true,
    });
    model = changeRoomValue(model, 'resolutionMethod', 'policy', catalog);
    model = chooseRoomChoice(model, freestyle);
    assert({
      given: 'choosing a choice over a retained intent',
      should: 'clear the intent so later edits keep landing',
      actual: [
        model.values.intent,
        changeRoomValue(model, 'resolutionMethod', 'policy', catalog).draft
          .custom,
      ],
      expected: ['', true],
    });
  });
});
