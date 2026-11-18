import type { LeagueRequestNotice } from '@daisy/db';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { EmailMessage } from '../mail/types';
import { MAIL_MAX_ATTEMPTS } from '../mail/retry-policy';
import { createLeagueRequestNotices } from './owner-notice';

setupRitewayBun();

const request: Extract<LeagueRequestNotice, { kind: 'request' }>['request'] = {
  id: 'k3v9q2w8e7r6t5y4u3i2o1pa',
  leagueName: 'Gulf Coast Speech League',
  schools: '26-50',
  seasons: '3-plus',
  style: 'freestyle',
  divisions: 'youth-and-open',
  needs: '',
  contactName: 'Dana Whitfield',
  contactRole: 'League director',
  contactEmail: 'dana@gulfcoastspeech.org',
  contactPhone: '',
  receivedAt: '2026-11-18T09:00:00.000Z',
};

const scripted = (input: {
  readonly notice?: LeagueRequestNotice | Error;
  readonly attempts?: number;
  readonly deliver?: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
}) => {
  const sent: EmailMessage[] = [];
  const settled: unknown[] = [];
  const failures: unknown[] = [];
  const lost: unknown[] = [];
  const notices = createLeagueRequestNotices({
    store: {
      claimLeagueRequestNotices: async () => [
        { id: request.id, attempts: input.attempts ?? 1, token: 'tok' },
      ],
      readLeagueRequestNotice: async () => {
        const notice = input.notice ?? { kind: 'request', request };
        if (notice instanceof Error) throw notice;
        return notice;
      },
      settleLeagueRequestNotice: async ({ outcome }) => {
        settled.push(outcome);
        return true;
      },
    },
    deliver:
      input.deliver ??
      (async (message) => {
        sent.push(message);
        return 'sent';
      }),
    ownerAddress: 'owner@daisy.example',
    nextToken: () => 'tok',
    now: () => '2026-11-18T10:00:00.000Z',
    failed: (error) => failures.push(error),
    gaveUp: (error) => lost.push(error),
  });
  return { notices, sent, settled, failures, lost };
};

test('a League request notice', async () => {
  {
    const { notices, sent, settled } = scripted({});
    const count = await notices.run(10);
    assert({
      given: 'a due request',
      should:
        'email the owner under the request id, with every label, and settle it sent',
      actual: {
        count,
        to: sent[0]?.to,
        key: sent[0]?.idempotencyKey,
        subject: sent[0]?.subject,
        labels: [
          'Schools: 26 to 50',
          'Seasons a year: 3 or more',
          'Style: Freestyle',
          'Divisions: Youth and Open',
          'No notes given.',
          'Reply to Dana Whitfield: mailto:dana@gulfcoastspeech.org?subject=Your%20Daisy%20league%20request%3A%20Gulf%20Coast%20Speech%20League',
        ].every((line) => sent[0]?.text.includes(line)),
        phoneLine: sent[0]?.text.includes('Phone:'),
        settled,
      },
      expected: {
        count: 1,
        to: 'owner@daisy.example',
        key: `league-request:${request.id}`,
        subject: 'League request: Gulf Coast Speech League',
        labels: true,
        phoneLine: false,
        settled: [{ kind: 'sent' }],
      },
    });
  }

  {
    const { sent, settled, notices } = scripted({ notice: { kind: 'gone' } });
    await notices.run(10);
    assert({
      given: 'a request deleted before its notice went',
      should: 'cancel the notice and send nothing',
      actual: { sent: sent.length, settled },
      expected: {
        sent: 0,
        settled: [{ kind: 'cancelled', errorCode: 'not-owed' }],
      },
    });
  }

  {
    const { settled, lost, notices } = scripted({
      deliver: async () => 'suppressed',
    });
    await notices.run(10);
    assert({
      given: 'an owner address that is suppressed',
      should:
        'cancel as suppressed and report it, since every lead would vanish the same way',
      actual: { settled, lost: lost.length },
      expected: {
        settled: [{ kind: 'cancelled', errorCode: 'suppressed' }],
        lost: 1,
      },
    });
  }

  {
    const { settled, notices } = scripted({
      deliver: async () => {
        throw new Error('provider down for dana@gulfcoastspeech.org');
      },
    });
    await notices.run(10);
    assert({
      given: 'a send that fails',
      should: 'retry later with backoff',
      actual: settled,
      expected: [
        {
          kind: 'retry',
          errorCode: 'delivery',
          nextAttemptAt: '2026-11-18T10:00:30.000Z',
        },
      ],
    });
  }

  {
    const { sent, notices } = scripted({
      notice: {
        kind: 'request',
        request: { ...request, needs: 'Standings.\n\nSanctioning.' },
      },
    });
    await notices.run(10);
    assert({
      given: 'notes over several lines',
      should: 'send each line as its own paragraph',
      actual: {
        paragraphs: (
          sent[0]?.html.match(
            /<p[^>]*>(What they need:|Standings\.|Sanctioning\.)<\/p>/g,
          ) ?? []
        ).length,
      },
      expected: {
        paragraphs: 3,
      },
    });
  }

  {
    const { failures, lost, notices } = scripted({
      deliver: async () => {
        throw new Error('provider down');
      },
    });
    await notices.run(10);
    assert({
      given: 'a send that fails with attempts left',
      should: 'report nothing yet',
      actual: failures.length + lost.length,
      expected: 0,
    });
  }

  {
    const gaveUp = new Error('still down');
    const { settled, lost, notices } = scripted({
      attempts: MAIL_MAX_ATTEMPTS,
      deliver: async () => {
        throw gaveUp;
      },
    });
    await notices.run(10);
    assert({
      given: 'a send that fails on its last attempt',
      should: 'fail for good and report it as lost, so the lead is seen',
      actual: { settled, lost },
      expected: {
        settled: [{ kind: 'failed', errorCode: 'delivery' }],
        lost: [gaveUp],
      },
    });
  }

  {
    const unreadable = new Error('pool refused');
    const { settled, failures, lost, notices } = scripted({
      attempts: MAIL_MAX_ATTEMPTS,
      notice: unreadable,
    });
    await notices.run(10);
    assert({
      given: 'a read that fails on the last attempt',
      should: 'report it as lost and name the stored data, not the provider',
      actual: { settled, failures, lost },
      expected: {
        settled: [{ kind: 'failed', errorCode: 'unreadable' }],
        failures: [],
        lost: [unreadable],
      },
    });
  }

  {
    const unreadable = new Error('read failed');
    const { settled, failures, notices } = scripted({ notice: unreadable });
    await notices.run(10);
    assert({
      given: 'a request that cannot be read',
      should: 'report it and retry, without aborting the batch',
      actual: { failures, kind: (settled[0] as { kind: string }).kind },
      expected: { failures: [unreadable], kind: 'retry' },
    });
  }
});
