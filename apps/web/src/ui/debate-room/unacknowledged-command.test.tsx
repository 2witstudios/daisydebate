import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
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
  renderToStaticMarkup(
    <UnacknowledgedCommand answer={answer} post={() => {}} pending={pending} />,
  );

test('only an unacknowledged, still-valid original envelope can be retried', () => {
  const html = render({ kind: 'unacknowledged', values: original });
  assert({
    given:
      'an unacknowledged yield envelope, then an acknowledged one, one with a stray field and a malformed one',
    should:
      'offer one retry form carrying the original envelope, and nothing for the others',
    actual: [
      html.includes('aria-label="Retry unacknowledged command"'),
      html.includes(`name="commandId" value="${id}"`),
      html.includes('name="type" value="yield"'),
      render({ kind: 'idle', values: original }),
      render({ kind: 'unacknowledged', values: { ...original, note: 'x' } }),
      render({
        kind: 'unacknowledged',
        values: { ...original, commandId: 'bad' },
      }),
    ],
    expected: [true, true, true, '', '', ''],
  });
});

test('a pending retry is busy and cannot be sent twice', () => {
  const html = render({ kind: 'unacknowledged', values: original }, true);
  assert({
    given: 'a retry already in flight',
    should: 'mark the form busy and disable its button',
    actual: [
      html.includes('aria-busy="true"'),
      html.includes('disabled=""'),
      html.includes('Retrying…'),
    ],
    expected: [true, true, true],
  });
});

test('a retried strike carries the turn and position the debater struck', () => {
  const html = render({
    kind: 'unacknowledged',
    values: {
      ...original,
      type: 'strike_resolution',
      ordinal: '1',
      position: '2',
    },
  });
  assert({
    given: 'an unacknowledged strike',
    should: 'offer a retry carrying its ordinal and position',
    actual: [
      html.includes('name="ordinal" value="1"'),
      html.includes('name="position" value="2"'),
    ],
    expected: [true, true],
  });
});

test('the retry posts exactly the fields the debater sent, its segment included (ISSUE-838)', () => {
  const html = render({
    kind: 'unacknowledged',
    values: { ...original, confirmed: 'true', segment: '0' },
  });
  assert({
    given: 'an unacknowledged confirmed yield sent from segment 0',
    should: 'offer a retry carrying the same segment and confirmation',
    actual: [
      html.includes('name="segment" value="0"'),
      html.includes('name="confirmed" value="true"'),
    ],
    expected: [true, true],
  });
});
