import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { parseDmDecisionForm } from './decide-form';
setupRitewayBun();
test('native DM decision validates bound scope and exactly one explicit choice/request', async () => {
  const channelId = 'channel'.padEnd(24, 'x'),
    requestId = 'request'.padEnd(24, 'x');
  const form = new FormData();
  form.set('requestId', requestId);
  form.set('decision', 'accept');
  assert({
    given: 'a native recipient acceptance',
    should: 'construct only the portable scoped command',
    actual: parseDmDecisionForm(channelId, form),
    expected: { version: 1, channelId, requestId, decision: 'accept' },
  });
  form.append('decision', 'decline');
  await assertRejects({
    given: 'a repeated decision field',
    should: 'refuse ambiguous form data',
    actual: () => parseDmDecisionForm(channelId, form),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'a forged bound channel ID',
    should: 'refuse before sending the command',
    actual: () => parseDmDecisionForm('invalid', form),
    code: 'VALIDATION',
  });
});
