import type { LeagueRequestNotice } from '@daisy/db/stores/league-requests';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { EmailMessage } from '../mail/types';
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

const scripted = (input: { readonly notice?: LeagueRequestNotice }) => {
  const sent: EmailMessage[] = [];
  const settled: unknown[] = [];
  const notices = createLeagueRequestNotices({
    store: {
      claimLeagueRequestNotices: async () => [
        { id: request.id, attempts: 1, token: 'tok' },
      ],
      readLeagueRequestNotice: async () =>
        input.notice ?? { kind: 'request', request },
      settleLeagueRequestNotice: async ({ outcome }) => {
        settled.push(outcome);
        return true;
      },
    },
    deliver: async (message) => {
      sent.push(message);
      return 'sent';
    },
    ownerAddress: 'owner@daisy.example',
    nextToken: () => 'tok',
    now: () => '2026-11-18T10:00:00.000Z',
    failed: () => {},
    gaveUp: () => {},
  });
  return { notices, sent, settled };
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
});
