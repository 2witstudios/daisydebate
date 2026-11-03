import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { reportAnswerText, reportNotice, submitReport } from './submit-report';

setupRitewayBun();

const form = () => {
  const data = new FormData();
  data.set('targetKind', 'round');
  data.set('targetId', 't'.repeat(24));
  data.set('reason', 'spam');
  return data;
};

describe('Submitting a report', () => {
  test('it sends only the three closed fields', async () => {
    let sent: unknown;
    const data = form();
    data.set('note', 'stray');
    await submitReport(async (_url, init) => {
      sent = JSON.parse(String(init.body));
      return new Response('{}');
    }, data);
    assert({
      given: 'a form with a stray field',
      should: 'leave it out',
      actual: sent,
      expected: {
        targetKind: 'round',
        targetId: 't'.repeat(24),
        reason: 'spam',
      },
    });
  });

  test('each response has one answer', async () => {
    const respond = (status: number) => async () =>
      new Response('{}', { status });
    assert({
      given: 'accepted, refused, down, and a network failure',
      should: 'name each outcome',
      actual: [
        await submitReport(respond(200), form()),
        await submitReport(respond(404), form()),
        await submitReport(respond(503), form()),
        await submitReport(async () => {
          throw new TypeError('offline');
        }, form()),
      ],
      expected: ['received', 'refused', 'unavailable', 'unavailable'],
    });
  });

  test('only a closed notice comes back from the URL', () => {
    assert({
      given: 'a real outcome and something forged',
      should: 'keep the first and drop the second',
      actual: [reportNotice('received'), reportNotice('<script>')],
      expected: ['received', null],
    });
  });

  test('the reporter is told what happened', () => {
    assert({
      given: 'a received report',
      should: 'thank them',
      actual: reportAnswerText('received'),
      expected: 'Thanks. Your report reached the moderation team.',
    });
  });
});
