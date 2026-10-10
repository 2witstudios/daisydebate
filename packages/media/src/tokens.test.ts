import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { TokenVerifier } from 'livekit-server-sdk';
import { createMediaService } from './index';
setupRitewayBun();

const config = {
  url: 'http://127.0.0.1:7880',
  apiKey: 'test-key',
  apiSecret: 'test-only-secret',
};
const room = 'r'.repeat(24);
const identity = 'i'.repeat(24);

describe('media join credentials', () => {
  for (const capture of [false, true])
    test(`signs exact least-privilege ${capture ? 'capture' : 'participant'} grants`, async () => {
      const service = createMediaService({ config });
      const token = await service.joinToken({
        room,
        identity,
        capture,
        publish: capture ? [] : ['camera', 'microphone'],
        subscribe: true,
      });
      const payload = await new TokenVerifier(
        config.apiKey,
        config.apiSecret,
      ).verify(token);
      const claims = JSON.parse(
        Buffer.from(token.split('.')[1]!, 'base64url').toString(),
      ) as { exp: number; nbf: number; video: Record<string, unknown> };
      assert({
        given: 'a signed server credential',
        should:
          'expire after 60 seconds with an opaque identity and empty name',
        // The SDK reads time separately for expiry and not-before.
        actual: [
          claims.exp - claims.nbf >= 59 && claims.exp - claims.nbf <= 60,
          payload.sub,
          payload.name,
        ],
        expected: [true, identity, ''],
      });
      assert({
        given: 'explicit publication sources',
        should: 'carry no administration, metadata update or data grant',
        actual: claims.video,
        expected: {
          roomJoin: true,
          room,
          canPublish: !capture,
          canSubscribe: true,
          canPublishData: false,
          canPublishSources: capture ? [] : ['camera', 'microphone'],
          canUpdateOwnMetadata: false,
          hidden: capture,
        },
      });
      assert({
        given: 'capture uses a dependent agent rather than a seat',
        should: 'mark only capture as agent',
        actual: payload.kind,
        expected: capture ? 'agent' : undefined,
      });
    });

  test('empty sources never become the vendor unrestricted publish default', async () => {
    const token = await createMediaService({ config }).joinToken({
      room,
      identity,
      publish: [],
      subscribe: true,
      capture: false,
    });
    const payload = await new TokenVerifier(
      config.apiKey,
      config.apiSecret,
    ).verify(token);
    assert({
      given: 'no authorized publication sources',
      should: 'explicitly refuse publication',
      actual: payload.video?.canPublish,
      expected: false,
    });
  });

  test('hidden judge is a seated subscriber rather than a capture agent', async () => {
    const token = await createMediaService({ config }).joinToken({
      room,
      identity,
      publish: [],
      subscribe: true,
      capture: false,
      hidden: true,
    });
    const payload = await new TokenVerifier(
      config.apiKey,
      config.apiSecret,
    ).verify(token);
    assert({
      given: 'an explicitly hidden seated subscriber',
      should: 'remain hidden without agent kind or publication',
      actual: [payload.video?.hidden, payload.kind, payload.video?.canPublish],
      expected: [true, undefined, false],
    });
  });

  test('refuses missing config and capture publication before signing', async () => {
    await assertRejects({
      given: 'missing composition credentials',
      should: 'fail closed',
      actual: () =>
        createMediaService({}).joinToken({
          room,
          identity,
          publish: [],
          subscribe: true,
          capture: false,
        }),
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'a capture identity requesting publication',
      should: 'refuse invalid grant input',
      actual: () =>
        createMediaService({ config }).joinToken({
          room,
          identity,
          publish: ['microphone'],
          subscribe: true,
          capture: true,
        }),
      code: 'VALIDATION',
    });
  });

  test('malformed service URLs fail as infrastructure without leaking input', async () => {
    await assertRejects({
      given: 'a malformed endpoint with private input',
      should: 'refuse composition with the safe error code',
      actual: () =>
        createMediaService({
          config: { ...config, url: 'bad private endpoint' },
        }),
      code: 'INFRASTRUCTURE',
    });
  });
});
