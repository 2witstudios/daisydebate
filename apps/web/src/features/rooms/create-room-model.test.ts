import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { freestyleChoice, unequalTemplate } from './assembly.test-support';
import {
  changeRoomValue,
  chooseRoomChoice,
  initialRoomModel,
} from './create-room-model';

setupRitewayBun();

const catalog = [freestyleChoice, unequalTemplate];
const freestyle = freestyleChoice;

describe('the create-room model', () => {
  test('a Room opens public, and a kept host choice stands', () => {
    assert({
      given: 'a fresh editor, then one carrying a refused post set to unlisted',
      should:
        'open public (never unlisted) and keep the host’s explicit choice',
      actual: [
        initialRoomModel(freestyle, catalog, {}, false).values.visibility,
        initialRoomModel(freestyle, catalog, { visibility: 'unlisted' }, false)
          .values.visibility,
      ],
      expected: ['public', 'unlisted'],
    });
  });

  test('an edit and its revert both follow the decoded draft, not a forced format', () => {
    let model = initialRoomModel(freestyle, catalog, {}, false);
    assert({
      given: 'the Freestyle standard chosen',
      should: 'run the standard, not Custom',
      actual: [
        model.values.format,
        model.draft.custom,
        model.draft.basis.formatId,
      ],
      expected: ['freestyle', false, 'freestyle'],
    });
    model = changeRoomValue(model, 'resolutionMethod', 'custom', catalog);
    assert({
      given: 'the resolution changed away from the standard’s strike',
      should: 'decode as Custom while the basis stays Freestyle',
      actual: [
        model.draft.custom,
        model.draft.basis.formatId,
        model.draft.ranked,
      ],
      expected: [true, 'freestyle', false],
    });
    model = changeRoomValue(model, 'resolutionMethod', 'strike', catalog);
    assert({
      given: 'the edit reverted to the standard resolution',
      should: 'read as the Freestyle standard again',
      actual: [
        model.draft.custom,
        model.draft.basis.formatId,
        model.draft.ranked,
      ],
      expected: [false, 'freestyle', false],
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
      freestyle,
      catalog,
      { title: 'Kept', intent: 'format' },
      true,
    );
    assert({
      given: 'a refused native post carried back with a title and its intent',
      should:
        'keep the title, stay on the named format, and drop the consumed intent',
      actual: [kept.values.title, kept.values.format, kept.values.intent],
      expected: ['Kept', 'freestyle', ''],
    });
    const fresh = initialRoomModel(
      freestyle,
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
      actual: changeRoomValue(model, 'resolutionMethod', 'custom', catalog)
        .draft.custom,
      expected: true,
    });
    model = changeRoomValue(model, 'resolutionMethod', 'custom', catalog);
    model = chooseRoomChoice(model, freestyle);
    assert({
      given: 'choosing a choice over a retained intent',
      should: 'clear the intent so later edits keep landing',
      actual: [
        model.values.intent,
        changeRoomValue(model, 'resolutionMethod', 'custom', catalog).draft
          .custom,
      ],
      expected: ['', true],
    });
  });
});
