import type { SupportMessageNotice } from '@daisy/db';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { EmailMessage } from '../mail/types';
import { createSupportMessageNotices } from './owner-notice';

setupRitewayBun();

const message: Extract<SupportMessageNotice, { kind: 'message' }>['message'] = {
  id: 'k3v9q2w8e7r6t5y4u3i2o1pa',
  topic: 'safety',
  message: 'Someone was rude in chat.\n\nIt was after the round.',
  about: 'Round with @dana on Tuesday',
  replyEmail: 'sam@example.test',
  memberUsername: 'sam',
  receivedAt: '2026-11-22T09:00:00.000Z',
};

const scripted = (notice: SupportMessageNotice) => {
  const sent: EmailMessage[] = [];
  const settled: unknown[] = [];
  const notices = createSupportMessageNotices({
    store: {
      claimSupportMessageNotices: async () => [
        { id: message.id, attempts: 1, token: 'tok' },
      ],
      readSupportMessageNotice: async () => notice,
      settleSupportMessageNotice: async ({ outcome }) => {
        settled.push(outcome);
        return true;
      },
    },
    deliver: async (email) => {
      sent.push(email);
      return 'sent';
    },
    ownerAddress: 'owner@daisy.example',
    nextToken: () => 'tok',
    now: () => '2026-11-22T10:00:00.000Z',
    failed: () => {},
    gaveUp: () => {},
  });
  return { notices, sent, settled };
};

test('a support message notice', async () => {
  {
    const { notices, sent, settled } = scripted({ kind: 'message', message });
    const count = await notices.run(10);
    assert({
      given: 'a due message from a signed-in member',
      should:
        'email the owner under the message id with every field, its sender and a reply link, and settle it sent',
      actual: {
        count,
        to: sent[0]?.to,
        key: sent[0]?.idempotencyKey,
        subject: sent[0]?.subject,
        lines: [
          'Topic: A safety concern',
          'About: Round with @dana on Tuesday',
          'Member: @sam',
          'Reply to: sam@example.test',
          'Someone was rude in chat.',
          'It was after the round.',
          'Reply: mailto:sam@example.test?subject=Re%3A%20your%20Daisy%20support%20message%20(A%20safety%20concern)',
        ].filter((line) => !sent[0]?.text.includes(line)),
        settled,
      },
      expected: {
        count: 1,
        to: 'owner@daisy.example',
        key: `support:${message.id}`,
        subject: 'Support: A safety concern',
        lines: [],
        settled: [{ kind: 'sent' }],
      },
    });
  }

  {
    const { notices, sent } = scripted({
      kind: 'message',
      message: { ...message, about: '', memberUsername: null },
    });
    await notices.run(10);
    assert({
      given: 'a message sent signed out with no page named',
      should: 'say it was sent signed out and leave the about line out',
      actual: [
        sent[0]?.text.includes('Sent signed out'),
        sent[0]?.text.includes('About:'),
      ],
      expected: [true, false],
    });
  }

  {
    const { notices, sent, settled } = scripted({ kind: 'gone' });
    await notices.run(10);
    assert({
      given: 'a message deleted before its notice went',
      should: 'cancel the notice and send nothing',
      actual: { sent: sent.length, settled },
      expected: {
        sent: 0,
        settled: [{ kind: 'cancelled', errorCode: 'not-owed' }],
      },
    });
  }
});
