import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  draftedPreview,
  pickedPreview,
  previewDefinition,
  previewStatus,
  savedPreview,
} from './ballot-preview-source';
import {
  authoringView,
  completeDraft,
  leagueBallotV2,
  leagueBallotV3,
  leagueDefinitionId,
  publishForm,
} from './ballot-preview-source.test-support';

setupRitewayBun();

describe('ballot preview source', () => {
  test('the saved ballot', () => {
    const view = authoringView();
    assert({
      given: 'nothing changed yet',
      should: 'draw the saved definition and say so',
      actual: [
        previewDefinition(view, savedPreview),
        previewStatus(view, savedPreview),
      ],
      expected: [
        leagueBallotV2,
        'The saved ballot, version 2. Changes you make here show before you save.',
      ],
    });
  });

  test('a host who can change nothing', () => {
    const view = authoringView({
      capabilities: { publish: false, pin: false, setScreening: false },
    });
    assert({
      given: 'no capability to publish or pick',
      should: 'say only that this is the saved ballot',
      actual: previewStatus(view, savedPreview),
      expected: 'The saved ballot, version 2.',
    });
  });

  test('a picked version', () => {
    const view = authoringView();
    const picked = pickedPreview(view, `${leagueDefinitionId}@3`);
    assert({
      given: 'another stored version picked but not yet used',
      should: 'draw that version and say it is not yet the event ballot',
      actual: [
        previewDefinition(view, picked),
        previewStatus(view, picked),
        pickedPreview(view, `${leagueDefinitionId}@2`),
      ],
      expected: [
        leagueBallotV3,
        "League ballot, version 3: not yet this event's ballot.",
        savedPreview,
      ],
    });
  });

  test("Daisy's ballot picked", () => {
    const view = authoringView();
    const picked = pickedPreview(view, 'daisy');
    assert({
      given: "Daisy's ballot picked for an event on a stored one",
      should: 'keep the saved ballot and say Daisy’s shows once used',
      actual: [previewDefinition(view, picked), previewStatus(view, picked)],
      expected: [
        leagueBallotV2,
        "The saved ballot, version 2. Daisy's ballot for this format shows once you use it.",
      ],
    });
  });

  test('a complete draft', () => {
    const view = authoringView();
    const drafted = draftedPreview(
      view,
      publishForm(completeDraft),
      savedPreview,
    );
    assert({
      given: 'the publish form filled in completely',
      should: 'draw the definition its fields make, marked unpublished',
      actual: [previewDefinition(view, drafted), previewStatus(view, drafted)],
      expected: [
        {
          key: 'ballot-league',
          revision: 2,
          decision: {
            kind: 'winner',
            lowPointWin: false,
            tie: true,
            doubleLoss: false,
          },
          points: {
            per: 'side',
            scale: { min: 1, max: 10, step: 1 },
            default: 7,
            criteria: { kind: 'holistic' },
            weights: null,
          },
          speakerRanks: false,
          written: { reason: { required: false, max: 500 }, feedback: null },
        },
        'An unpublished draft. Judges get it only once it is published and selected.',
      ],
    });
  });

  test('an incomplete draft', () => {
    const view = authoringView();
    const complete = draftedPreview(
      view,
      publishForm(completeDraft),
      savedPreview,
    );
    const broken = publishForm({ ...completeDraft, 'score-max': '' });
    const after = draftedPreview(view, broken, complete);
    const first = draftedPreview(view, broken, savedPreview);
    assert({
      given: 'a field emptied, after a complete draft and with none before',
      should:
        'keep the last complete draft, or the saved ballot, and say the draft is unfinished',
      actual: [
        previewDefinition(view, after) === previewDefinition(view, complete),
        previewStatus(view, after),
        previewDefinition(view, first),
        previewStatus(view, first),
      ],
      expected: [
        true,
        'An unpublished draft, as it last stood complete. Finish its fields to preview the rest.',
        leagueBallotV2,
        "The saved ballot, version 2. Finish the draft's fields to preview it.",
      ],
    });
  });
});
