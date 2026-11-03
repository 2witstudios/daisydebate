import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint } from '@daisy/protocol';
import { credentialHash } from './stage-access';
import { createStageRoute } from './stage-route';

setupRitewayBun();

const secret = 'stage-secret';
type Deps = Parameters<typeof createStageRoute>[0];
const route = (over: object = {}, revokedAt: Date | null = null) => {
  const minted: unknown[] = [];
  return {
    minted,
    run: createStageRoute({
      store: {
        readStage: async () => ({
          capture: {
            stageCredentialHash: credentialHash(secret),
            observerRevokedAt: revokedAt,
            completedAt: null,
            stoppedAt: null,
            heartbeatStale: false,
            ...over,
          },
          round: {
            id: 'r',
            status: 'opening',
            rules: { segments: [], seats: {} },
            participants: [],
            checkpoint: emptyRuntimeCheckpoint,
            segments: [],
          },
          roomName: 'room',
          seats: [],
        }),
      },
      observerToken: async (room: string, access: unknown) => {
        minted.push([room, access]);
        return 'token';
      },
      livekitUrl: 'wss://lk.test',
      now: () => 1000,
      nextId: () => 'id',
    } as unknown as Deps),
  };
};
const ask = (credential?: string) =>
  new Request('https://d.test/api/stage/b', {
    headers: credential ? { 'x-stage-credential': credential } : {},
  });

describe('stage route', () => {
  test('without the credential it answers as if nothing exists', async () => {
    const { run, minted } = route();
    const answers = await Promise.all([
      run(ask(), 'b'),
      run(ask('wrong'), 'b'),
    ]);
    assert({
      given: 'no credential and a wrong one',
      should: 'answer 404 and mint no token',
      actual: [answers.map((a) => a.status), minted],
      expected: [[404, 404], []],
    });
  });
  test('a stale heartbeat tells the stage to end, and only its own stage', async () => {
    const { run, minted } = route({ heartbeatStale: true });
    const [held, stranger] = await Promise.all([
      run(ask(secret), 'b'),
      run(ask('wrong'), 'b'),
    ]);
    assert({
      given: 'no control plane lately, with the credential and without',
      should: 'say 410 to the credential alone, minting nothing',
      actual: [held.status, stranger.status, minted],
      expected: [410, 404, []],
    });
  });
  test('a stopped or completed Broadcast refuses even the right credential', async () => {
    const answers = await Promise.all([
      route({ stoppedAt: new Date(1) }).run(ask(secret), 'b'),
      route({ completedAt: new Date(1) }).run(ask(secret), 'b'),
    ]);
    assert({
      given: 'a takedown and a finished Broadcast',
      should: 'refuse',
      actual: answers.map((a) => a.status),
      expected: [404, 404],
    });
  });
});
