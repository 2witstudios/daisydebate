import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isRoundClockResponse } from '../e2e/support/round-timing-response';

setupRitewayBun();

const actionResponse = (body: Response, actionId: string, method = 'POST') => ({
  request: () => ({
    method: () => method,
    headers: () => ({ 'next-action': actionId }),
  }),
  text: () => body.text(),
});

test('the resume witness does not consume unrelated Server Action bodies', async () => {
  const transcript = new Response('{"kind":"found","value":{}}');
  await transcript.text();
  const unrelated = await isRoundClockResponse(
    actionResponse(transcript, 'transcript-action'),
    'clock-action',
  ).catch(() => 'unrelated-body-read');
  assert({
    given: 'a different Server Action whose response body is unavailable',
    should: 'leave it unread instead of failing the Round clock witness',
    actual: unrelated,
    expected: false,
  });
});

test('the resume witness requires the observed clock action and clock field', async () => {
  assert({
    given: 'the observed clock action and a clock response body',
    should: 'accept only the matching POST carrying the server-clock field',
    actual: await Promise.all([
      isRoundClockResponse(
        actionResponse(new Response('{"serverNowMs":20000}'), 'clock-action'),
        'clock-action',
      ),
      isRoundClockResponse(
        actionResponse(new Response('{"kind":"unavailable"}'), 'clock-action'),
        'clock-action',
      ),
      isRoundClockResponse(
        actionResponse(
          new Response('{"serverNowMs":20000}'),
          'clock-action',
          'GET',
        ),
        'clock-action',
      ),
      isRoundClockResponse(
        actionResponse(new Response('{"serverNowMs":20000}'), ''),
        '',
      ),
    ]),
    expected: [true, false, false, false],
  });
});

test('the resume witness propagates matching clock response body failures', async () => {
  const clock = new Response('{"serverNowMs":20000}');
  await clock.text();
  assert({
    given: 'the actual clock response body is unavailable',
    should:
      'preserve the failure rather than treating missing evidence as a match',
    actual: await isRoundClockResponse(
      actionResponse(clock, 'clock-action'),
      'clock-action',
    ).then(
      () => 'swallowed',
      (error: unknown) => error instanceof TypeError,
    ),
    expected: true,
  });
});
