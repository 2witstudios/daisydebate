import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { postedBy } from './posted-fields.test-support';
import { UnacknowledgedCommand } from './unacknowledged-command';

setupRitewayBun();

const id = 'a'.repeat(24);
const original = {
  version: '1',
  commandId: id,
  expectedVersion: '3',
  type: 'yield',
  participantId: id,
};
const render = (
  answer: Parameters<typeof UnacknowledgedCommand>[0]['answer'],
  pending = false,
) =>
  renderAccessible(
    <UnacknowledgedCommand answer={answer} post={() => {}} pending={pending} />,
  );
const FORM = 'Retry unacknowledged command';

test('only an unacknowledged, still-valid original envelope can be retried', () => {
  const view = render({ kind: 'unacknowledged', values: original });
  const retry = [
    view.has('form', FORM),
    postedBy(view.within('form', FORM), 'Retry command'),
  ] as const;
  assert({
    given:
      'an unacknowledged yield envelope, then an acknowledged one, one with a stray field and a malformed one',
    should:
      'offer one retry form carrying the original envelope, and nothing for the others',
    actual: [
      retry[0],
      retry[1].commandId,
      retry[1].type,
      render({ kind: 'idle', values: original }).textContent(),
      render({
        kind: 'unacknowledged',
        values: { ...original, note: 'x' },
      }).textContent(),
      render({
        kind: 'unacknowledged',
        values: { ...original, commandId: 'bad' },
      }).textContent(),
    ],
    expected: [true, id, 'yield', '', '', ''],
  });
});

test('a pending retry is busy and cannot be sent twice', () => {
  const view = render({ kind: 'unacknowledged', values: original }, true);
  assert({
    given: 'a retry already in flight',
    should: 'mark the form busy and disable its button',
    actual: [
      view.attribute('form', FORM, 'aria-busy'),
      view.get('button', 'Retrying…').hasAttribute('disabled'),
    ],
    expected: ['true', true],
  });
});

test('a retried strike carries the turn and position the debater struck', () => {
  const posted = postedBy(
    render({
      kind: 'unacknowledged',
      values: {
        ...original,
        type: 'strike_resolution',
        ordinal: '1',
        position: '2',
      },
    }),
    'Retry command',
  );
  assert({
    given: 'an unacknowledged strike',
    should: 'offer a retry carrying its ordinal and position',
    actual: [posted.ordinal, posted.position],
    expected: ['1', '2'],
  });
});

test('the retry posts exactly the fields the debater sent, its segment included (ISSUE-838)', () => {
  const posted = postedBy(
    render({
      kind: 'unacknowledged',
      values: { ...original, confirmed: 'true', segment: '0' },
    }),
    'Retry command',
  );
  assert({
    given: 'an unacknowledged confirmed yield sent from segment 0',
    should: 'offer a retry carrying the same segment and confirmation',
    actual: [posted.segment, posted.confirmed],
    expected: ['0', 'true'],
  });
});
