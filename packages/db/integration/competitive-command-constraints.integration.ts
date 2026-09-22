import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { at, digest, indexDefinition, withFixture } from './constraint-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

describe('debate commands (DATA-2.3)', () => {
  test('exactly one principal, a SHA3-256 digest and a unique command id', async () => {
    await withFixture(url, async (fixture) => {
      const debateId = await fixture.debate();
      const actorId = await fixture.actor();
      const command = (overrides: Record<string, unknown>) => ({
        command_id: createId(),
        debate_id: debateId,
        actor_id: actorId,
        service_id: null,
        type: 'debate.join',
        payload_digest: digest,
        result: {},
        resulting_version: 2,
        applied_at: at,
        ...overrides,
      });
      const byActor = command({});
      const accepted = !(await fixture.rejects(
        'debate_commands',
        byActor,
        'command_id',
      ));
      const byService = !(await fixture.rejects(
        'debate_commands',
        command({ actor_id: null, service_id: 'foundation-proof' }),
        'command_id',
      ));
      const bothSet = await fixture.rejects(
        'debate_commands',
        command({ service_id: 'foundation-proof' }),
        'command_id',
      );
      const neitherSet = await fixture.rejects(
        'debate_commands',
        command({ actor_id: null }),
        'command_id',
      );
      const shortDigest = await fixture.rejects(
        'debate_commands',
        command({ payload_digest: 'a'.repeat(63) }),
        'command_id',
      );
      const upperDigest = await fixture.rejects(
        'debate_commands',
        command({ payload_digest: 'A'.repeat(64) }),
        'command_id',
      );
      const duplicateId = await fixture.rejects(
        'debate_commands',
        command({ command_id: byActor.command_id }),
        'command_id',
      );
      const index = await indexDefinition(
        fixture,
        'debate_commands_debate_version_idx',
      );
      assert({
        given: 'command rows varying principal, digest and id',
        should:
          'accept one actor or one service principal with a 64-hex digest, reject the rest, and index (debate_id, resulting_version)',
        actual: {
          accepted,
          byService,
          bothSet,
          neitherSet,
          shortDigest,
          upperDigest,
          duplicateId,
          indexed: index?.includes('(debate_id, resulting_version)'),
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
