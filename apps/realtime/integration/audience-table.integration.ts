import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { systemId } from '@daisy/clock';
import { buildDebateTopic, buildUserInboxTopic } from '@daisy/protocol';
import {
  socketAuthorityFixture,
  issueAuthorityTicket,
} from './socket-authority.test-support';
import { openAuthorityPeer } from './authority-peer.test-support';
import { roundAudienceFixture } from './round-audience.test-support';

setupRitewayBun();
requireTestServices(process.env);

test('native restricted-role audience table uses persisted Round seats and canonical own inbox authority', async () => {
  const fixture = await socketAuthorityFixture();
  const rounds = roundAudienceFixture(fixture.client, fixture.actorId);
  try {
    const port = fixture.runtime.server.port;
    if (port === undefined)
      throw new Error('Actual authority listener unavailable');
    const peer = await openAuthorityPeer(
      port,
      await issueAuthorityTicket(fixture),
    );
    const cases = [
      ['public outsider', (await rounds.seed('public')).topic, 'subscribed'],
      [
        'private affirmative',
        (await rounds.seed('private', 'affirmative')).topic,
        'subscribed',
      ],
      [
        'private negative',
        (await rounds.seed('private', 'negative')).topic,
        'subscribed',
      ],
      [
        'private judge',
        (await rounds.seed('private', 'judge')).topic,
        'subscribed',
      ],
      ['private outsider', (await rounds.seed('private')).topic, 'error'],
      ['own inbox', buildUserInboxTopic(fixture.actorId), 'subscribed'],
      ['foreign inbox', buildUserInboxTopic(systemId.next()), 'error'],
      ['standings member', 'standings:audience-proof', 'subscribed'],
      [
        'unimplemented registry',
        `${buildDebateTopic(systemId.next())}:chat`,
        'error',
      ],
    ] as const;
    for (const [label, topic, expected] of cases) {
      const id = systemId.next();
      const reply = await peer.subscribe(topic, id);
      assert({
        given: label,
        should:
          'return the canonical decision correlated to the exact native request',
        actual: {
          type: reply.type,
          id: 'id' in reply ? reply.id : null,
          code: reply.type === 'error' ? reply.code : null,
        },
        expected: {
          type: expected,
          id,
          code: expected === 'error' ? 'AUTHORIZATION' : null,
        },
      });
    }
  } finally {
    await fixture.runtime.close();
    await rounds.close();
    await fixture.close();
  }
});

test('native subscription limit preserves existing subscribers and correlates its documented refusal', async () => {
  const fixture = await socketAuthorityFixture(undefined, 1);
  try {
    const port = fixture.runtime.server.port;
    if (port === undefined)
      throw new Error('Actual authority listener unavailable');
    const peer = await openAuthorityPeer(
      port,
      await issueAuthorityTicket(fixture),
    );
    await peer.subscribe('standings:first', 'first');
    const reply = await peer.subscribe('standings:second', 'second');
    assert({
      given: 'one actual allowed native subscription at the configured limit',
      should: 'refuse the next request with RATE_LIMIT and its request ID',
      actual:
        reply.type === 'error'
          ? { code: reply.code, id: reply.id }
          : reply.type,
      expected: { code: 'RATE_LIMIT', id: 'second' },
    });
  } finally {
    await fixture.close();
  }
});
