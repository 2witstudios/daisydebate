import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readParentAnswer, signedFrom } from './parent-forms';

setupRitewayBun();

const form = () => {
  const data = new FormData();
  data.set('name', ' Elena Rivera ');
  data.set('relation', 'legal_guardian');
  data.set('paidAds', 'on');
  return data;
};

test('reading a parent route’s answer', async () => {
  assert({
    given: 'a done answer',
    should: 'pass it on',
    actual: await readParentAnswer(Response.json({ kind: 'done' }), form()),
    expected: { ok: true, body: { kind: 'done' } },
  });
  const refused = await readParentAnswer(
    Response.json({ kind: 'refused', reason: 'expired' }),
    form(),
  );
  assert({
    given: 'a refusal',
    should: 'say why in words, keeping what was typed',
    actual: refused.ok
      ? null
      : [
          refused.state.kind,
          refused.state.kind === 'refused' ? refused.state.error : '',
          refused.state.values['name'],
        ],
    expected: ['refused', 'This link has expired.', ' Elena Rivera '],
  });
  const kinds = async (response: Response) => {
    const read = await readParentAnswer(response, form());
    return read.ok ? 'ok' : read.state.kind;
  };
  assert({
    given: 'a server fault, an unreadable body, a closed page and a limit',
    should: 'be unacknowledged, unacknowledged, refused and refused',
    actual: [
      await kinds(new Response(null, { status: 503 })),
      await kinds(new Response('nope', { status: 200 })),
      await kinds(new Response(null, { status: 404 })),
      await kinds(new Response(null, { status: 429 })),
    ],
    expected: ['unacknowledged', 'unacknowledged', 'refused', 'refused'],
  });
});

test('what the confirmation shows', () => {
  assert({
    given: 'an accepted sign form',
    should: 'show the trimmed name, relation, paid-ads choice and time',
    actual: signedFrom(form(), '2026-11-16T14:32:00.000Z'),
    expected: {
      kind: 'signed',
      name: 'Elena Rivera',
      relation: 'legal_guardian',
      paidAds: true,
      signedAt: '2026-11-16T14:32:00.000Z',
    },
  });
});
