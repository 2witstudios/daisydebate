import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderToStaticMarkup } from 'react-dom/server';
import { BotAdmissionNotice } from './bot-admission-notice';
setupRitewayBun();
test('host bot freeze notice states allowance and first-call consequence', () => {
  const html = renderToStaticMarkup(
    <BotAdmissionNotice
      admission={{
        kind: 'allowance',
        limit: 1,
        remaining: 1,
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-11-01T00:00:00.000Z',
        refusal: null,
      }}
    />,
  );
  assert({
    given: 'one free monthly allowance available',
    should: 'explain reservation and model-call counting truthfully',
    actual: [
      html.includes('1 of 1'),
      html.includes('first model call'),
      html.includes('vendor failure'),
      html.includes('2026-11-01'),
    ],
    expected: [true, true, true, true],
  });
});
test('missing or exhausted allowance never claims premium or availability', () => {
  for (const admission of [
    { kind: 'unavailable' } as const,
    {
      kind: 'allowance' as const,
      limit: 10 as const,
      remaining: 0,
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      refusal: 'allowance' as const,
    },
  ]) {
    const html = renderToStaticMarkup(
      <BotAdmissionNotice admission={admission} />,
    );
    assert({
      given: 'unavailable or exhausted admission',
      should: 'state that a bot Round cannot launch',
      actual: html.includes('Bot Round cannot launch'),
      expected: true,
    });
  }
  assert({
    given: 'no host-only admission metadata',
    should: 'reveal nothing',
    actual: renderToStaticMarkup(<BotAdmissionNotice admission={null} />),
    expected: '',
  });
});
