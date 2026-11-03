import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sendPayloadDigest } from '../send-plan';
import type { SpectatorChannelFacts } from '@daisy/db/messaging';
import { planSpectatorPost } from './post-decision';

setupRitewayBun();

const channelId = createId();
const actorId = createId();
const now = '2026-11-02T12:00:30.000Z';
const command = {
  version: 1 as const,
  channelId,
  requestId: createId(),
  text: 'A line',
};
const account = { erased: false, restricted: false, underThirteen: false };
const facts = (
  over: Partial<SpectatorChannelFacts> = {},
): SpectatorChannelFacts => ({
  broadcast: { open: true, slowModeSeconds: 0 },
  account,
  banned: false,
  lastPostAtMs: null,
  ...over,
});
const state = {
  counters: { channelId, messageSequence: 4, changeVersion: 9 },
  receipt: null,
  existingMessage: null,
  reply: null,
};
const plan = (f: SpectatorChannelFacts, s = state as never) =>
  planSpectatorPost(f, s, command, { actorId, messageId: createId(), now });
const refused = (f: SpectatorChannelFacts) => {
  try {
    plan(f);
    return null;
  } catch (error) {
    return (
      (error as { reason?: string; code?: string }).reason ??
      (error as { code?: string }).code
    );
  }
};

describe('planSpectatorPost', () => {
  test('an open Broadcast takes the next place in the stream', () => {
    const planned = plan(facts());
    assert({
      given: 'an account on an open Broadcast',
      should: 'plan the next sequence and revision',
      actual: [
        planned.kind,
        planned.message.sequence,
        planned.message.changeVersion,
      ],
      expected: ['create', 5, 10],
    });
  });

  test('refuses by rule', () => {
    assert({
      given:
        'no Broadcast, a closed one, a ban, a restricted account, a slow-mode window',
      should: 'refuse each with its own fixed key',
      actual: [
        refused(facts({ broadcast: null })),
        refused(facts({ broadcast: { open: false, slowModeSeconds: 0 } })),
        refused(facts({ banned: true })),
        refused(facts({ account: { ...account, restricted: true } })),
        refused(
          facts({
            broadcast: { open: true, slowModeSeconds: 60 },
            lastPostAtMs: Date.parse(now) - 1000,
          }),
        ),
      ],
      expected: [
        'chat-unavailable',
        'chat-closed',
        'chat-banned',
        'chat-banned',
        'chat-slow-mode',
      ],
    });
  });

  test('a closed account or a child under thirteen is refused outright', async () => {
    for (const closed of [
      { ...account, erased: true },
      { ...account, underThirteen: true },
    ])
      await assertRejects({
        given: 'an account that cannot post at all',
        should: 'refuse the post',
        actual: async () => plan(facts({ account: closed })),
        code: 'AUTHORIZATION',
      });
  });

  test('slow mode passes once its window has gone', () => {
    assert({
      given: 'a last post 61 seconds ago under a 60 second slow mode',
      should: 'allow the post',
      actual: plan(
        facts({
          broadcast: { open: true, slowModeSeconds: 60 },
          lastPostAtMs: Date.parse(now) - 61_000,
        }),
      ).kind,
      expected: 'create',
    });
  });

  test('a retry replays through slow mode and a closed Broadcast, not through a ban', () => {
    const message = {
      id: createId(),
      channelId,
      authorActorId: actorId,
      sequence: 4,
      changeVersion: 9,
      text: command.text,
      createdAt: now,
      editedAt: null,
      removedAt: null,
    };
    const retried = {
      ...state,
      receipt: {
        payloadDigest: sendPayloadDigest(command),
        messageId: message.id,
      },
      existingMessage: message,
    } as never;
    assert({
      given: 'a request id already answered, under each refusal',
      should: 'replay it, unless the account is now banned',
      actual: [
        plan(
          facts({
            broadcast: { open: false, slowModeSeconds: 60 },
            lastPostAtMs: Date.parse(now),
          }),
          retried,
        ).kind,
        (() => {
          try {
            return plan(facts({ banned: true }), retried).kind;
          } catch (error) {
            return (error as { reason?: string }).reason;
          }
        })(),
      ],
      expected: ['replay', 'chat-banned'],
    });
  });
});
