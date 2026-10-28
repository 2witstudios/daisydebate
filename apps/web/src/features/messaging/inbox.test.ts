import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import {
  decideMessagingInboxCandidate,
  messagingInboxEntries,
  messagingInboxExcerpt,
  messagingInboxView,
  summarizeMessagingInboxEntry,
} from './inbox';
import { typingWorld } from './typing.test-support';
setupRitewayBun();
const decide = (
  f: ReturnType<typeof typingWorld>,
  candidate: Parameters<typeof decideMessagingInboxCandidate>[0],
  ageOf: Parameters<typeof decideMessagingInboxCandidate>[1],
) => {
  const self = f.accounts[0]!.account;
  return decideMessagingInboxCandidate(candidate, ageOf, {
    principal: { kind: 'user', userId: self.userId, actorId: self.actorId },
    clock: { now: () => f.now },
    now: f.now,
    postingPolicy: f.policy.posting,
    readingPolicy: f.policy.reading,
  });
};
test('a candidate is shown only under its own fenced grant; outages are never an omission', async () => {
  const f = typingWorld();
  const ages = new Map(f.accounts.map((row) => [row.account.actorId, row.age]));
  const ageOf = (account: { readonly actorId: string | null }) =>
    ages.get(account.actorId!)!;
  const channel = {
    fact: f.channel,
    accounts: f.accounts.map((row) => row.account),
  };
  assert({
    given: 'an accepted DM whose cast is fenced and current',
    should: 'show the conversation and ask only for its message summary',
    actual: await decide(
      f,
      { channelId: f.channel.channelId, channel, invitation: null },
      ageOf,
    ),
    expected: {
      kind: 'conversation',
      summary: { counterpartActorId: f.ids[1]!, content: 'messages' },
    },
  });
  assert({
    given:
      'a counterpart account that vanished under the fence, and no invitation',
    should: 'omit the candidate rather than refuse the page',
    actual: await decide(
      f,
      {
        channelId: f.channel.channelId,
        channel: { ...channel, accounts: [channel.accounts[0]!, null] },
        invitation: null,
      },
      ageOf,
    ),
    expected: null,
  });
  await assertRejects({
    given: 'an age fact outage',
    should: 'refuse the page rather than fabricate an omission',
    code: 'INFRASTRUCTURE',
    actual: () =>
      decide(
        f,
        { channelId: f.channel.channelId, channel, invitation: null },
        () => {
          throw createAppError('INFRASTRUCTURE');
        },
      ),
  });
});

test('inbox entries lead with invitations, then the newest activity', () => {
  const [a, b, c] = ['a'.repeat(24), 'b'.repeat(24), 'c'.repeat(24)];
  const summary = (createdAt: string) => ({
    title: 'kelvin',
    lastMessage: null,
    introduction: null,
    createdAt,
    unread: false,
  });
  const conversation = {
    kind: 'conversation' as const,
    summary: { counterpartActorId: null, content: 'messages' as const },
  };
  assert({
    given: 'an older conversation, a newer one and a pending invitation',
    should: 'order the invitation first and then newest activity first',
    actual: messagingInboxEntries([
      {
        channelId: a,
        decision: conversation,
        summary: summary('2026-10-01T00:00:00.000Z'),
      },
      {
        channelId: b,
        decision: conversation,
        summary: summary('2026-10-03T00:00:00.000Z'),
      },
      {
        channelId: c,
        decision: { kind: 'incoming_invitation', summary: null },
        summary: null,
      },
    ]).map((entry) => entry.channelId),
    expected: [c, b, a],
  });
});
test('summaries prefer the newest message, then the request introduction', () => {
  const base = {
    title: 'kelvin',
    lastMessage: null,
    introduction: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    unread: false,
  };
  const channelId = 'c'.repeat(24);
  assert({
    given: 'a conversation with a newest message',
    should: 'preview that message at its time',
    actual: summarizeMessagingInboxEntry(channelId, 'conversation', {
      ...base,
      lastMessage: {
        text: 'Good round\n\nthanks',
        fromSelf: true,
        createdAt: '2026-10-02T00:00:00.000Z',
      },
      unread: true,
    }),
    expected: {
      channelId,
      kind: 'conversation',
      title: 'kelvin',
      preview: { text: 'Good round thanks', fromSelf: true },
      activityAt: '2026-10-02T00:00:00.000Z',
      unread: true,
    },
  });
  assert({
    given: 'a request without an introduction',
    should: 'show no preview and date it by the request',
    actual: summarizeMessagingInboxEntry(channelId, 'incoming_request', {
      ...base,
      introduction: {
        text: null,
        fromSelf: false,
        requestedAt: '2026-10-05T00:00:00.000Z',
      },
      unread: true,
    }),
    expected: {
      channelId,
      kind: 'incoming_request',
      title: 'kelvin',
      preview: null,
      activityAt: '2026-10-05T00:00:00.000Z',
      unread: true,
    },
  });
  assert({
    given: 'an empty new group',
    should: 'date it by its creation',
    actual: summarizeMessagingInboxEntry(channelId, 'group_conversation', {
      ...base,
      title: 'Policy club',
    }).activityAt,
    expected: '2026-10-01T00:00:00.000Z',
  });
});
test('excerpts are one bounded line', () => {
  const long = messagingInboxExcerpt('word '.repeat(60)) ?? '';
  assert({
    given: 'a message longer than the preview bound',
    should: 'cut it within the bound and mark the cut',
    actual: [long.length <= 120, long.endsWith('…')],
    expected: [true, true],
  });
  const emoji = messagingInboxExcerpt('😀'.repeat(100)) ?? '';
  assert({
    given: 'astral characters at the cut',
    should: 'never split a surrogate pair',
    actual: [emoji.length <= 120, /\uD83D(?!\uDE00)/.test(emoji)],
    expected: [true, false],
  });
  const title = summarizeMessagingInboxEntry(
    'c'.repeat(24),
    'group_conversation',
    {
      title: 'T'.repeat(500),
      lastMessage: null,
      introduction: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      unread: false,
    },
  ).title;
  assert({
    given: 'a group title longer than the inbox title bound',
    should: 'cut it rather than refuse the whole inbox',
    actual: [title?.length, title?.endsWith('…')],
    expected: [200, true],
  });
  assert({
    given: 'whitespace only',
    should: 'yield no excerpt',
    actual: messagingInboxExcerpt(' \n '),
    expected: null,
  });
});
test("a reader's own grant decides the entry kind, fence and content", () => {
  const [me, them] = ['a'.repeat(24), 'b'.repeat(24)];
  const dm = (state: string, sender: string) => ({
    kind: 'dm' as const,
    state,
    requestSenderActorId: sender,
    lowActorId: me,
    highActorId: them,
  });
  assert({
    given: 'a group, an accepted DM, a sent request and a received request',
    should:
      'read history only for approved conversations and only the introduction for requests',
    actual: [
      messagingInboxView({ kind: 'private_group' }, me),
      messagingInboxView(dm('accepted', them), me),
      messagingInboxView(dm('pending', me), me),
      messagingInboxView(dm('pending', them), me),
    ],
    expected: [
      {
        kind: 'group_conversation',
        capability: 'channel.read',
        counterpartActorId: null,
        content: 'messages',
      },
      {
        kind: 'conversation',
        capability: 'channel.read',
        counterpartActorId: them,
        content: 'messages',
      },
      {
        kind: 'outgoing_request',
        capability: 'channel.request.status',
        counterpartActorId: them,
        content: 'introduction',
      },
      {
        kind: 'incoming_request',
        capability: 'channel.request.read',
        counterpartActorId: them,
        content: 'introduction',
      },
    ],
  });
  assert({
    given: 'the reader as the high actor of the pair',
    should: 'name the low actor as the counterpart',
    actual: messagingInboxView(dm('accepted', me), them).counterpartActorId,
    expected: me,
  });
});
