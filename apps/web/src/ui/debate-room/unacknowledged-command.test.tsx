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
  const html = render({ values: original, unacknowledged: true });
  assert({
    given:
      'an unacknowledged yield envelope, then an acknowledged one, one with a stray field and a malformed one',
    should:
      'offer one retry form carrying the original envelope, and nothing for the others',
    actual: [
      html.includes('aria-label="Retry unacknowledged command"'),
      html.includes(`name="commandId" value="${id}"`),
      html.includes('name="type" value="yield"'),
      render({ values: original }),
      render({ values: { ...original, note: 'x' }, unacknowledged: true }),
      render({
        values: { ...original, commandId: 'bad' },
        unacknowledged: true,
      }),
    ],
    expected: [true, true, true, '', '', ''],
  });
});

test('a pending retry is busy and cannot be sent twice', () => {
  const html = render({ values: original, unacknowledged: true }, true);
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

test('the retry posts exactly the fields the debater sent, its segment included (ISSUE-838)', () => {
  const html = render({
    values: { ...original, confirmed: 'true', segment: '0' },
    unacknowledged: true,
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
