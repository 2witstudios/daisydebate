import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  IMPACT_STEM,
  checkStructure,
  drillUnavailable,
  emptyText,
  initialDrill,
  parseDrillForm,
  stepDrill,
  withImpactStem,
  type DrillInput,
} from './drill';

setupRitewayBun();

const claim = 'Cities should fund public transit first.';
const warrant =
  'Clinics, schools and jobs only serve people who can reach them, and transit is how most of them arrive.';
const impact =
  'Households with no car lose the most, because they cannot reach work or care at all.';

describe('checkStructure', () => {
  test('all three clear', () => {
    const check = checkStructure({ claim, warrant, impact });
    assert({
      given: 'a full claim, warrant and impact',
      should: 'find all three clear',
      actual: [
        check.parts.map((p) => p.status),
        check.clearCount,
        check.allClear,
      ],
      expected: [['clear', 'clear', 'clear'], 3, true],
    });
  });

  test('empty parts are missing', () => {
    const check = checkStructure(emptyText);
    assert({
      given: 'nothing written',
      should: 'mark every part missing and none clear',
      actual: [
        check.parts.map((p) => p.status),
        check.clearCount,
        check.allClear,
      ],
      expected: [['missing', 'missing', 'missing'], 0, false],
    });
  });

  test('missing impact says to use a stem', () => {
    const [, , impactCheck] = checkStructure({
      claim,
      warrant,
      impact: '',
    }).parts;
    assert({
      given: 'no impact',
      should: 'say it is missing and suggest a stem',
      actual: impactCheck?.message,
      expected:
        'Missing. Say why it matters and to whom. Try a stem: “This matters because ... for ...”.',
    });
  });

  test('a short part needs work', () => {
    const check = checkStructure({ claim: 'Transit.', warrant, impact });
    assert({
      given: 'a claim of one word',
      should: 'mark it needs-work, not missing',
      actual: check.parts[0]?.status,
      expected: 'needs-work',
    });
  });

  test('a vague phrase is marked and fails the warrant', () => {
    const vagueWarrant =
      'Everything else depends on people being able to get around the city every day.';
    const check = checkStructure({ claim, warrant: vagueWarrant, impact });
    const warrantCheck = check.parts[1];
    assert({
      given: 'a long warrant that says everything else depends on transit',
      should: 'need work and point at the vague phrase',
      actual: [
        warrantCheck?.status,
        warrantCheck?.highlight,
        vagueWarrant.slice(
          warrantCheck?.highlight?.start,
          warrantCheck?.highlight?.end,
        ),
      ],
      expected: [
        'needs-work',
        { start: 0, end: 26 },
        'Everything else depends on',
      ],
    });
  });

  test('thresholds are inclusive', () => {
    assert({
      given: 'a claim of exactly 15 characters and one of 14',
      should: 'clear the first only',
      actual: [
        checkStructure({ ...emptyText, claim: 'a'.repeat(15) }).parts[0]
          ?.status,
        checkStructure({ ...emptyText, claim: 'a'.repeat(14) }).parts[0]
          ?.status,
      ],
      expected: ['clear', 'needs-work'],
    });
  });

  test('whitespace does not count as writing', () => {
    assert({
      given: 'a claim of spaces',
      should: 'be missing',
      actual: checkStructure({ ...emptyText, claim: '      ' }).parts[0]
        ?.status,
      expected: 'missing',
    });
  });
});

describe('withImpactStem', () => {
  test('starts an empty impact and keeps a written one', () => {
    assert({
      given: 'an empty impact and a written one',
      should: 'add the stem only to the empty one',
      actual: [
        withImpactStem(emptyText).impact,
        withImpactStem({ ...emptyText, impact: 'Mine.' }).impact,
      ],
      expected: [IMPACT_STEM, 'Mine.'],
    });
  });
});

const input = (over: Partial<DrillInput>): DrillInput => ({
  intent: 'check',
  mode: 'write',
  text: { claim, warrant, impact },
  ...over,
});

describe('stepDrill', () => {
  test('check moves to checked with the result', () => {
    const state = stepDrill(
      input({ intent: 'check', text: { claim, warrant, impact: '' } }),
    );
    assert({
      given: 'a check with the impact missing',
      should: 'be checked with two parts clear, text kept',
      actual: [state.phase, state.check?.clearCount, state.text.impact],
      expected: ['checked', 2, ''],
    });
  });

  test('checking nothing says so and stays editing', () => {
    const state = stepDrill(input({ text: emptyText }));
    assert({
      given: 'a check with nothing written',
      should: 'stay in edit with the nothing-to-check notice',
      actual: [state.phase, state.notice, state.check],
      expected: ['edit', 'nothing-to-check', null],
    });
  });

  test('revise returns to editing and keeps the text', () => {
    const state = stepDrill(input({ intent: 'revise' }));
    assert({
      given: 'revise after a check',
      should: 'be editing with the same text and no result',
      actual: [state.phase, state.text.claim === claim, state.check],
      expected: ['edit', true, null],
    });
  });

  test('save needs all three parts clear', () => {
    assert({
      given: 'save with everything clear, and with the impact missing',
      should: 'save only the first; the second stays checked',
      actual: [
        stepDrill(input({ intent: 'save' })).phase,
        stepDrill(
          input({ intent: 'save', text: { claim, warrant, impact: '' } }),
        ).phase,
      ],
      expected: ['saved', 'checked'],
    });
  });

  test('the stem and the modes', () => {
    assert({
      given: 'the stem on an empty impact, then the speak and write modes',
      should: 'fill the stem and switch mode without losing text',
      actual: [
        stepDrill(input({ intent: 'stem', text: emptyText })).text.impact,
        stepDrill(input({ intent: 'mode-speak' })).mode,
        stepDrill(input({ intent: 'mode-write', mode: 'speak' })).mode,
        stepDrill(input({ intent: 'mode-speak' })).text.claim === claim,
      ],
      expected: [IMPACT_STEM, 'speak', 'write', true],
    });
  });

  test('an unknown intent just edits', () => {
    assert({
      given: 'no intent',
      should: 'stay in edit with the text',
      actual: stepDrill(input({ intent: null })).phase,
      expected: 'edit',
    });
  });
});

describe('parseDrillForm', () => {
  const form = (entries: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };

  test('reads a posted form', () => {
    assert({
      given: 'a check with text and the speak mode',
      should: 'read intent, mode and text',
      actual: parseDrillForm(
        form({ intent: 'check', mode: 'speak', claim, warrant, impact }),
      ),
      expected: {
        intent: 'check',
        mode: 'speak',
        text: { claim, warrant, impact },
      },
    });
  });

  test('untrusted input falls back and is capped', () => {
    const parsed = parseDrillForm(
      form({
        intent: 'delete-everything',
        mode: 'both',
        claim: 'x'.repeat(5000),
      }),
    );
    assert({
      given: 'an unknown intent and mode and a 5000 character claim',
      should: 'drop the intent, default the mode and cap the text at 600',
      actual: [
        parsed.intent,
        parsed.mode,
        parsed.text.claim.length,
        parsed.text.warrant,
      ],
      expected: [null, 'write', 600, ''],
    });
  });

  test('a file in a text field is ignored', () => {
    const data = new FormData();
    data.set('claim', new File(['x'], 'x.txt'));
    assert({
      given: 'a file posted as the claim',
      should: 'read an empty claim',
      actual: parseDrillForm(data).text.claim,
      expected: '',
    });
  });
});

describe('drillUnavailable', () => {
  test('keeps the text and says it could not reach the server', () => {
    const data = new FormData();
    data.set('claim', claim);
    data.set('mode', 'speak');
    const state = drillUnavailable(data);
    assert({
      given: 'a post that never arrived',
      should: 'keep what was typed and the mode, in edit with the notice',
      actual: [state.phase, state.text.claim, state.mode, state.notice],
      expected: ['edit', claim, 'speak', 'unavailable'],
    });
    assert({
      given: 'the initial drill',
      should: 'be an empty edit',
      actual: [initialDrill.phase, initialDrill.notice],
      expected: ['edit', null],
    });
  });
});
