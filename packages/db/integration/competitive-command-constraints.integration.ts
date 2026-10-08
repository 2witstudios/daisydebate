import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { at, digest, indexDefinition, withFixture } from './constraint-helpers';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('round commands (DATA-2.3)', () => {
  test('exactly one principal, a SHA3-256 digest and a unique command id', async () => {
    await withFixture(url, async (fixture) => {
      const roundId = await fixture.round();
      const actorId = await fixture.actor();
      const command = (overrides: Record<string, unknown>) => ({
        command_id: createId(),
        round_id: roundId,
        actor_id: actorId,
        service_id: null,
        type: 'start',
        payload_digest: digest,
        result: {},
        resulting_version: 2,
        applied_at: at,
        ...overrides,
      });
      const byActor = command({});
      const accepted = !(await fixture.rejects(
        'round_commands',
        byActor,
        'command_id',
      ));
      const byService = !(await fixture.rejects(
        'round_commands',
        command({ actor_id: null, service_id: 'foundation-proof' }),
        'command_id',
      ));
      const bothSet = await fixture.rejects(
        'round_commands',
        command({ service_id: 'foundation-proof' }),
        'command_id',
      );
      const neitherSet = await fixture.rejects(
        'round_commands',
        command({ actor_id: null }),
        'command_id',
      );
      const shortDigest = await fixture.rejects(
        'round_commands',
        command({ payload_digest: 'a'.repeat(63) }),
        'command_id',
      );
      const upperDigest = await fixture.rejects(
        'round_commands',
        command({ payload_digest: 'A'.repeat(64) }),
        'command_id',
      );
      const duplicateId = await fixture.rejects(
        'round_commands',
        command({ command_id: byActor.command_id }),
        'command_id',
      );
      const index = await indexDefinition(
        fixture,
        'round_commands_round_version_idx',
      );
      assert({
        given: 'command rows varying principal, digest and id',
        should:
          'accept one actor or one service principal with a 64-hex digest, reject the rest, and index (round_id, resulting_version)',
        actual: {
          accepted,
          byService,
          bothSet,
          neitherSet,
          shortDigest,
          upperDigest,
          duplicateId,
          indexed: index?.includes('(round_id, resulting_version)'),
        },
        expected: {
          accepted: true,
          byService: true,
          bothSet: true,
          neitherSet: true,
          shortDigest: true,
          upperDigest: true,
          duplicateId: true,
          indexed: true,
        },
      });
    });
  });
});
