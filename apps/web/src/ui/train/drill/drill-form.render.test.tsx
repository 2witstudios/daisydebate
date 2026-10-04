import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  checkStructure,
  initialDrill,
  type DrillState,
} from '../../../features/train/drill';
import {
  drillScreen,
  parseDrillQuery,
} from '../../../features/train/drill-view';
import { renderDrillForm } from './drill-form.render';

setupRitewayBun();

const screen = drillScreen(parseDrillQuery({}));
const html = (state: DrillState, pending = false) =>
  renderToString(
    <>{renderDrillForm({ state, screen, pending, post: () => {} })}</>,
  );

const claim = 'Cities should fund public transit first.';
const vague =
  'Everything else depends on people being able to get around the city every day.';
const impact =
  'Households with no car lose the most, because they cannot reach work or care at all.';
const warrant =
  'Clinics, schools and jobs only serve people who can reach them, and transit is how most of them arrive.';

const checked = (text: DrillState['text']): DrillState => ({
  ...initialDrill,
  phase: 'checked',
  text,
  check: checkStructure(text),
});

describe('renderDrillForm', () => {
  test('editing: the prompt, three fields and the check button', () => {
    const out = html(initialDrill);
    assert({
      given: 'a fresh drill',
      should: 'show the prompt, three named fields and Check structure',
      actual: [
        out.includes('Motion: Cities should fund public transit before roads.'),
        ['claim', 'warrant', 'impact'].every((n) =>
          out.includes(`name="${n}"`),
        ),
        out.includes('Check structure'),
        out.includes('Use a stem for impact'),
        out.includes('Suggested: 2 min'),
        out.includes('Revise'),
        out.includes('role="group"'),
      ],
      expected: [true, true, true, true, true, false, true],
    });
  });

  test('a form posted to the action, every control an intent', () => {
    const out = html(initialDrill);
    assert({
      given: 'a fresh drill',
      should: 'carry intents on submit buttons, including both modes',
      actual: [
        out.includes('<form'),
        /<button[^>]*name="intent"[^>]*value="check"|<button[^>]*value="check"[^>]*name="intent"/.test(
          out,
        ),
        out.includes('value="mode-speak"'),
        out.includes('value="mode-write"'),
        out.includes('aria-pressed="true"'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('speak mode fakes no recording', () => {
    const out = html({ ...initialDrill, mode: 'speak' });
    assert({
      given: 'the speak mode',
      should: 'fake no recording',
      actual: out.includes('Recording'),
      expected: false,
    });
  });

  test('speak is unavailable until speech exists', () => {
    const out = html(initialDrill);
    assert({
      given: 'the input mode choice',
      should: 'disable Speak and keep Write',
      actual: [
        /<button [^>]*value="mode-speak"[^>]*disabled=""/.test(out) ||
          /<button [^>]*disabled=""[^>]*value="mode-speak"/.test(out),
        /<button [^>]*value="mode-write"[^>]*disabled=""/.test(out),
      ],
      expected: [true, false],
    });
  });

  test('checked with parts needing work: statuses, the mark and Revise', () => {
    const out = html(checked({ claim, warrant: vague, impact: '' }));
    assert({
      given: 'a vague warrant and no impact, checked',
      should:
        'count one clear, mark the phrase, show statuses and offer Revise',
      actual: [
        out.includes('1 of 3 parts clear'),
        out.includes('<mark'),
        out.includes('Everything else depends on'),
        out.includes('Needs work'),
        out.includes('Missing'),
        out.includes('Nothing written yet'),
        out.includes('>Revise<'),
        out.includes('Save argument'),
        out.match(/type="hidden"/g)?.length,
      ],
      expected: [true, true, true, true, true, true, true, false, 4],
    });
  });

  test('all clear: Save and Edit again', () => {
    const out = html(checked({ claim, warrant, impact }));
    assert({
      given: 'everything clear',
      should: 'say so and offer Save argument and Edit again',
      actual: [
        out.includes('All three parts are clear.'),
        out.includes('Save argument'),
        out.includes('Edit again'),
        out.includes('>Revise<'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('saved: the argument and where to go', () => {
    const out = html({
      ...checked({ claim, warrant, impact }),
      phase: 'saved',
    });
    assert({
      given: 'a saved argument',
      should:
        'say it ran on sample data, never claim a save, show the argument and link on',
      actual: [
        out.includes('Save argument: done on sample data. Nothing was saved'),
        out.includes('Saved to review'),
        out.includes('not connected'),
        out.includes(claim),
        out.includes('Another drill'),
        out.includes('href="/train/review"'),
        out.includes('<form'),
      ],
      expected: [true, false, false, true, true, true, false],
    });
  });

  test('notices', () => {
    assert({
      given: 'the two notices',
      should: 'alert for each',
      actual: [
        html({ ...initialDrill, notice: 'nothing-to-check' }).includes(
          'Write at least one part before you check.',
        ),
        html({ ...initialDrill, notice: 'unavailable' }).includes(
          'What you wrote is kept; try again.',
        ),
        html(initialDrill).includes('role="alert"'),
      ],
      expected: [true, true, false],
    });
  });

  test('pending disables the buttons and marks the form busy', () => {
    const out = html(initialDrill, true);
    assert({
      given: 'a post in flight',
      should: 'be busy with disabled submit buttons',
      actual: [out.includes('aria-busy="true"'), out.includes('disabled=""')],
      expected: [true, true],
    });
  });
});
