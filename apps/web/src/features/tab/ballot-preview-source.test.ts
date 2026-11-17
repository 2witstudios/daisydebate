import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { previewDraftOn, sampleBallotPreview } from './ballot-definition';
import {
  draftedPreview,
  pickedPreview,
  previewDefinition,
  previewStatus,
  readChoice,
  savedPreview,
  shownSource,
  unchangedChoices,
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

  test('a draft with no name yet', () => {
    const view = authoringView();
    const unnamed = draftedPreview(
      view,
      publishForm({ ...completeDraft, 'definition-name': '' }),
      savedPreview,
    );
    const revision = draftedPreview(
      view,
      publishForm({
        ...completeDraft,
        'publish-target': leagueDefinitionId,
        'definition-name': '',
      }),
      savedPreview,
    );
    assert({
      given:
        'a complete draft as a new definition with no name, and as a revision',
      should:
        'draw both, saying only the new definition needs a name to publish',
      actual: [
        previewDefinition(view, unnamed)?.points?.scale.max,
        previewStatus(view, unnamed),
        previewStatus(view, revision),
      ],
      expected: [
        10,
        'An unpublished draft. Name it to publish it; judges get it only once it is published and selected.',
        'An unpublished draft. Judges get it only once it is published and selected.',
      ],
    });
  });

  test("Daisy's ballot picked again on an event that uses it", () => {
    const view = authoringView({ definition: null });
    assert({
      given:
        "an event with no stored ballot, another version picked, then Daisy's again",
      should: 'show the saved setting, not a pending change',
      actual: pickedPreview(view, 'daisy'),
      expected: savedPreview,
    });
  });
});

describe("the editor's two choices", () => {
  const view = authoringView();
  const shown = (choices: Parameters<typeof shownSource>[0]) =>
    previewStatus(view, shownSource(choices));
  const pick = (choices: Parameters<typeof shownSource>[0], value: string) =>
    readChoice(
      view,
      choices,
      'picked',
      publishForm({ 'ballot-version': value }),
    );
  const draft = (
    choices: Parameters<typeof shownSource>[0],
    fields: Readonly<Record<string, string>>,
  ) => readChoice(view, choices, 'drafted', publishForm(fields));

  test('a draft kept while the picker returns to the saved version', () => {
    const drafted = draft(unchangedChoices, completeDraft);
    const repicked = pick(drafted, `${leagueDefinitionId}@2`);
    assert({
      given: 'a complete draft, then the picker set back to the saved version',
      should: 'keep drawing the draft',
      actual: shown(repicked),
      expected:
        'An unpublished draft. Judges get it only once it is published and selected.',
    });
  });

  test('a picked version kept while a draft has never been complete', () => {
    const picked = pick(unchangedChoices, `${leagueDefinitionId}@3`);
    const unfinished = draft(picked, { ...completeDraft, 'score-max': '' });
    const finished = draft(unfinished, completeDraft);
    assert({
      given:
        'version 3 picked, then an unfinished draft, then the draft completed',
      should: 'keep drawing version 3, then draw the draft',
      actual: [shown(unfinished), shown(finished)],
      expected: [
        "League ballot, version 3: not yet this event's ballot.",
        'An unpublished draft. Judges get it only once it is published and selected.',
      ],
    });
  });

  test('a pin awaiting retry', () => {
    const picked = pick(unchangedChoices, `${leagueDefinitionId}@3`);
    const reset = pick(picked, `${leagueDefinitionId}@3`);
    const refused = pick(picked, `${leagueDefinitionId}@2`);
    assert({
      given:
        "the pin form reset with a retry's hidden version 3, and reset to the saved version 2",
      should:
        'draw version 3 for the retry, and the saved ballot after a refusal',
      actual: [shown(reset), shown(refused)],
      expected: [
        "League ballot, version 3: not yet this event's ballot.",
        'The saved ballot, version 2. Changes you make here show before you save.',
      ],
    });
  });
});

describe('preview sample answers', () => {
  test('fitted to the drawn scale', () => {
    const onScale = previewDraftOn(leagueBallotV2, sampleBallotPreview.draft);
    const offScale = previewDraftOn(
      {
        ...leagueBallotV2,
        points: {
          ...leagueBallotV2.points!,
          scale: { min: 1, max: 10, step: 1 },
          default: 7,
        },
      },
      sampleBallotPreview.draft,
    );
    assert({
      given:
        'sample scores of 28.5 and 27 on a 20 to 30 scale in halves, and on a 1 to 10 scale',
      should: 'keep them, and read each as the default 7',
      actual: [onScale.points, offScale.points],
      expected: [
        { jensen: 28.5, doyle: 27 },
        { jensen: 7, doyle: 7 },
      ],
    });
  });
});
