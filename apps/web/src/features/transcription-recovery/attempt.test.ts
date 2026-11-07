import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createTranscriptionAttempt } from './attempt';
import { originalBodies } from './audio.test-support';
setupRitewayBun();
function fixture() {
  const bodies = originalBodies(),
    events: string[] = [];
  let now = 100,
    admissions = 0,
    refused = false;
  const claim = {
    kind: 'claimed' as const,
    roundId: bodies[0]!.roundId,
    contextId: 'c'.repeat(24),
    claim: { workerId: 'w'.repeat(24), epoch: 1, token: 't'.repeat(43) },
    expiresAt: '2026-11-07T12:00:01.000Z',
    evidenceIds: bodies.map((body) => body.evidenceId),
    model: 'fixture-model',
    policyDigest: 'f'.repeat(64),
  };
  let response = async () => ({ text: 'Synthetic provisional words' });
  const store = {
    verify: async () => ({
      kind: 'current' as const,
      evidenceIds: claim.evidenceIds,
      attempts: admissions,
      model: claim.model,
      policyDigest: claim.policyDigest,
    }),
    begin: async () => {
      events.push('begin');
      admissions += 1;
      return admissions === 1
        ? {
            kind: 'admitted' as const,
            ordinal: 1,
            admittedAt: '2026-11-07T12:00:00.000Z',
            startBefore: '2026-11-07T12:00:01.000Z',
          }
        : { kind: 'already-admitted' as const, ordinal: 1 };
    },
    retry: async () => {
      events.push('retry');
      return { kind: 'retry' as const, retryAt: '2026-11-07T12:00:02.000Z' };
    },
    recordCandidate: async () => {
      events.push('candidate');
      return {
        kind: 'provisional' as const,
        digest: 'd'.repeat(64),
        ordinal: 1,
      };
    },
  };
  const restore = async (raw: unknown) => {
    const id = (raw as { evidenceId: string }).evidenceId,
      body = bodies.find((body) => body.evidenceId === id)!;
    return refused
      ? { kind: 'refused' as const, reason: 'revoked' as const }
      : {
          kind: 'restored' as const,
          body,
          speaker: {
            roundParticipantId: body.roundParticipantId,
            actorId: 'a'.repeat(24),
            kind: 'human' as const,
            role: 'affirmative' as const,
            slot: 0,
          },
          receipt: {
            kind: 'received' as const,
            evidenceId: id,
            bindingDigest: 'b'.repeat(64),
            payloadAcceptedAt: '2026-11-07T12:00:00.000Z',
            receipt: {
              evidenceId: id,
              bindingDigest: 'b'.repeat(64),
              authorityId: 'u'.repeat(24),
              receivedAtMs: 1794052800000,
              expiresAtMs: 1794657600000,
            },
          },
        };
  };
  const voice = {
    transcribe: async (request: { audioBase64: string }) => {
      events.push('provider');
      const bytes = Buffer.from(request.audioBase64, 'base64');
      if (
        bytes.length !== 684 ||
        bytes.readInt16LE(44) !== -1 ||
        bytes.readInt16LE(364) !== 1
      )
        throw new Error('Wrong original audio');
      return response();
    },
  };
  return {
    claim,
    events,
    store,
    restore,
    voice,
    monotonicNow: () => now,
    setNow: (value: number) => {
      now = value;
    },
    refuse: () => {
      refused = true;
    },
    respond: (value: typeof response) => {
      response = value;
    },
  };
}
test('a fresh durable admission invokes one provider call and yields only provisional text', async () => {
  const f = fixture(),
    execute = createTranscriptionAttempt(f),
    signal = new AbortController().signal;
  const first = await execute(f.claim, signal),
    again = await execute(f.claim, signal);
  assert({
    given:
      'authentically restored synthetic original-format bodies and one fresh admission followed by same-epoch replay',
    should:
      'invoke STT once with exact audio, record only provisional metadata and never dispatch the replay',
    actual: { kind: first.kind, again, events: f.events },
    expected: {
      kind: 'provisional',
      again: { kind: 'reconciled', ordinal: 1 },
      events: ['begin', 'provider', 'candidate', 'begin'],
    },
  });
});
test('a delayed admission reply cannot restart the call-start lifetime', async () => {
  const f = fixture(),
    begin = f.store.begin;
  f.store.begin = async () => {
    const grant = await begin();
    f.setNow(1100);
    return grant;
  };
  await assertRejects({
    given:
      'admission response arrives beyond the conservative pre-request deadline',
    should:
      'refuse provider dispatch and preserve an uncertain spent obligation',
    actual: () =>
      createTranscriptionAttempt(f)(f.claim, new AbortController().signal),
    code: 'CONFLICT',
  });
  assert({
    given: 'that delayed reply',
    should: 'buy no external call or candidate commit',
    actual: f.events,
    expected: ['begin', 'retry'],
  });
});
test('revocation or cancellation during a provider call fences its later candidate', async () => {
  for (const cause of ['revoke', 'cancel'] as const) {
    const f = fixture(),
      abort = new AbortController();
    f.respond(async () => {
      if (cause === 'revoke') f.refuse();
      else abort.abort();
      return { text: 'Late synthetic response' };
    });
    await assertRejects({
      given: `${cause} while the one authorized provider call runs`,
      should:
        'refuse its later provisional content commit without another invocation',
      actual: () => createTranscriptionAttempt(f)(f.claim, abort.signal),
      code: 'CONFLICT',
    });
    assert({
      given: 'that late response',
      should: 'retain recovery obligation and commit no candidate',
      actual: f.events,
      expected: ['begin', 'provider', 'retry'],
    });
  }
});
test('an unknown admission acknowledgement never becomes a provider retry', async () => {
  const f = fixture();
  f.store.begin = async () => {
    f.events.push('begin');
    throw new Error('Synthetic lost admission acknowledgement');
  };
  let failed = false;
  try {
    await createTranscriptionAttempt(f)(f.claim, new AbortController().signal);
  } catch {
    failed = true;
  }
  assert({
    given: 'the admission commit reply is unknown',
    should:
      'return failure, request retry bookkeeping and make zero external calls',
    actual: { failed, events: f.events },
    expected: { failed: true, events: ['begin', 'retry'] },
  });
});
