import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { RoomFormFields, RoomForm, type RoomFormState } from './room-form';
import type { RoomFormControls } from '../../features/rooms/room-form';
import { findElements } from '../test-support/find-elements';
setupRitewayBun();
const controls: RoomFormControls = {
  segments: [
    {
      key: 'AC',
      label: 'Affirmative constructive',
      side: 'affirmative',
      slot: 0,
      type: 'speech',
      defaultDurationMs: 360000,
      minDurationMs: 30000,
      maxDurationMs: 480000,
    },
    {
      key: 'NC',
      label: 'Negative constructive',
      side: 'negative',
      slot: 0,
      type: 'speech',
      defaultDurationMs: 420000,
      minDurationMs: 30000,
      maxDurationMs: 480000,
    },
    {
      key: 'AR',
      label: 'Affirmative rebuttal',
      side: 'affirmative',
      slot: 0,
      type: 'speech',
      defaultDurationMs: 180000,
      minDurationMs: 30000,
      maxDurationMs: 300000,
    },
    {
      key: 'NR',
      label: 'Negative rebuttal',
      side: 'negative',
      slot: 0,
      type: 'speech',
      defaultDurationMs: 240000,
      minDurationMs: 30000,
      maxDurationMs: 300000,
    },
  ],
  canEditSequence: true,
  acceptsSequence: () => true,
};
const saved = {
  sequence: ['AC', 'NC', 'AR'],
  durationsMs: { AC: 360000, NC: 420000, AR: 180000 },
};
const initial: RoomFormState = {
  draft: saved,
  saved,
  phase: 'draft',
  values: {},
  notice: undefined,
};
// Model only the compiler's progressive-form descriptor. This is renderer proof,
// not a running Next action or persistence proof.
function progressiveAction<T extends (...args: never[]) => unknown>(
  action: T,
): T {
  const descriptor = () => ({
    name: '$ACTION_ID_room-test',
    method: 'POST',
    action: '/room-action-test',
    encType: 'multipart/form-data',
    data: new FormData(),
  });
  return Object.assign(action, {
    $$FORM_ACTION: descriptor,
    bind: (...args: [unknown, ...unknown[]]) =>
      Object.assign(Function.prototype.bind.apply(action, args), {
        $$FORM_ACTION: descriptor,
      }),
  });
}
const props = (
  changes: Partial<RoomFormState> = {},
  editable = true,
  pending = false,
) => ({
  state: { ...initial, ...changes },
  controls,
  canEdit: editable,
  pending,
  post: progressiveAction(() => {}),
});
const html = (
  changes: Partial<RoomFormState> = {},
  editable = true,
  pending = false,
) => renderToString(<RoomFormFields {...props(changes, editable, pending)} />);
describe('standalone room form renderer', () => {
  test('team preview names the assigned speaker on each side', () => {
    const out = renderToString(
      <RoomFormFields
        {...props()}
        controls={{
          ...controls,
          segments: controls.segments.map((segment) => ({
            ...segment,
            slot: segment.side === 'affirmative' ? 1 : 2,
          })),
        }}
      />,
    );
    assert({
      given: 'speeches belonging to different teammates',
      should:
        'show the assigned seat alongside each speech rather than imply the first speaker owns every speech',
      actual: [
        out.includes('(Affirmative 2)'),
        out.includes('(Negative 3)'),
        out.includes('(Affirmative 1)'),
      ],
      expected: [true, true, false],
    });
  });
  test('renders unequal counts, exact preview and native intents', () => {
    const out = html();
    assert({
      given: 'a producer-injected three-speech sequence',
      should:
        'render independent durations, counts and native change/save intents',
      actual: [
        out.includes('Affirmative: 2 speeches'),
        out.includes('Negative: 1 speech'),
        out.includes('name="seconds.AC"'),
        out.includes('name="seconds.NC"'),
        out.includes('value="add:NR"'),
        out.includes('value="earlier:AR"'),
        out.includes('value="remove:AR"'),
        out.includes('value="save"'),
        out.includes('16:00'),
        /method="post"/i.test(out),
      ],
      expected: [true, true, true, true, true, true, true, true, true, true],
    });
  });
  test('all sequence changes submit through the injected action', async () => {
    const submissions: FormData[] = [];
    const tree = RoomFormFields({
      ...props(),
      post: (form) => {
        submissions.push(form);
      },
    });
    const form = findElements(tree, (e) => e.type === 'form')[0]!;
    const action = form.props['action'] as (form: FormData) => void;
    const posted = new FormData();
    posted.set('intent', 'add:NR');
    await action(posted);
    assert({
      given: 'the actual form element',
      should:
        'forward native intent to the injected action without a backend substitute',
      actual: submissions[0]?.get('intent'),
      expected: 'add:NR',
    });
  });
  test('viewer has saved preview and no editing controls', () => {
    const out = html(
      {
        draft: { ...saved, durationsMs: { ...saved.durationsMs, AC: 90000 } },
        values: { 'seconds.AC': 'wrong' },
      },
      false,
    );
    assert({
      given: 'no host edit capability',
      should: 'show saved state without save/add/remove authority',
      actual: [
        out.includes('Saved settings'),
        out.includes('value="360"'),
        out.includes('value="wrong"'),
        out.includes('1:30'),
        out.includes('value="save"'),
        out.includes('value="add:NR"'),
        out.includes('value="remove:AR"'),
        out.includes('disabled=""'),
      ],
      expected: [true, true, false, false, false, false, false, true],
    });
  });
  test('pending disables fields and submitted intents', () => {
    const out = html({}, true, true);
    const tags = out.match(/<(?:input|button)[^>]*>/g) ?? [];
    assert({
      given: 'a pending action',
      should: 'disable every mutable input/button and announce the busy state',
      actual: [
        out.includes('aria-busy="true"'),
        tags
          .filter((tag) => !tag.includes('type="hidden"'))
          .every((tag) => tag.includes('disabled=""')),
      ],
      expected: [true, true],
    });
  });
  test('refusal preserves a safely typed duration with an alert', () => {
    const out = html({
      phase: 'refused',
      notice: 'Choose a permitted length.',
      values: { 'seconds.AC': 'wrong' },
    });
    assert({
      given: 'a refused form answer',
      should: 'retain the value and reason without reporting saved changes',
      actual: [
        out.includes('value="wrong"'),
        out.includes('role="alert"'),
        out.includes('Choose a permitted length.'),
        out.includes('Settings saved'),
      ],
      expected: [true, true, true, false],
    });
  });
  test('conflict compares saved and draft without allowing stale save', () => {
    const out = html({
      phase: 'conflict',
      notice: 'The room changed.',
      draft: { ...saved, durationsMs: { ...saved.durationsMs, AC: 90000 } },
    });
    assert({
      given: 'a changed room and preserved draft',
      should:
        'show both exact previews, retain draft and block save until reread',
      actual: [
        out.includes('Draft preview'),
        out.includes('Saved settings'),
        out.includes('1:30'),
        out.includes('6:00'),
        /<button[^>]*value="save"[^>]*disabled=""/.test(out),
        out.includes('value="reread"'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
  test('fixed grammar offers duration edits without count/order changes', () => {
    const out = renderToString(
      <RoomFormFields
        {...props()}
        controls={{ ...controls, canEditSequence: false }}
      />,
    );
    assert({
      given: 'structural editing disabled by the producer',
      should: 'offer per-segment fields but no add/remove/order intents',
      actual: [
        out.includes('name="seconds.NC"'),
        out.includes('value="add:'),
        out.includes('value="remove:'),
        out.includes('value="earlier:'),
      ],
      expected: [true, false, false, false],
    });
  });
  test('connected wrapper reuses the existing action hook on server render', () => {
    const out = renderToString(
      <RoomForm
        initial={initial}
        controls={controls}
        canEdit
        action={progressiveAction(async (state: RoomFormState) => state)}
        unavailable={() => ({
          ...initial,
          phase: 'refused',
          notice: 'Unavailable',
        })}
      />,
    );
    assert({
      given: 'an injected action before hydration',
      should:
        'render a POST form and enabled save without an optimistic persistence claim',
      actual: [
        out.includes('<form'),
        out.includes('method="POST"') || out.includes('method="post"'),
        out.includes('value="save"'),
        out.includes('Settings saved'),
      ],
      expected: [true, true, true, false],
    });
  });
});
