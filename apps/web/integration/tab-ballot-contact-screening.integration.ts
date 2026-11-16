import { eventResultCommand } from '../src/features/tab/operations/event-result-command';
import {
  completionEnvelope,
  completionAnswer,
} from '../src/features/tab/completion-form';
import { createTabCommandRoute } from '../src/features/tab/command-route';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { noopErrorReporter } from '@daisy/observability';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { committingRuntimeTestDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { completionCommand } from '../src/features/tab/operations/completion-command';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { scratchDatabase } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedWrittenEventRoom } from './tab-written-event-room.test-support';
import { fixtureBallot } from './round-judging.test-support';
import { withActualCopiedBallot } from './tab-actual-ballot.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual ballot submission screens atomically, retains originals and replays without rescreening', async () => {
  const scratch = scratchDatabase(databaseUrl, 'contactscreen');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 2 });
  try {
    await scratch.migrate(() => true);
    const world = await committedWrittenEventRoom(owner);
    const written = { reason: 'Email judge@example.org for feedback' };
    await withActualCopiedBallot(
      {
        owner,
        databaseUrl: scratch.url,
        world,
        ballot: fixtureBallot(written.reason),
        beforeSubmission: async ({ roundId, submit }) => {
          await owner.unsafe(
            `create function reject_test_screening() returns trigger language plpgsql as $$ begin raise exception 'screening failure witness'; end $$`,
          );
          await owner.unsafe(
            'create trigger reject_test_screening before insert on ballot_screenings for each row execute function reject_test_screening()',
          );
          let refused = false;
          try {
            await submit();
          } catch (error) {
            let cause: unknown = error;
            while (cause instanceof Error) {
              if (cause.message.includes('screening failure witness')) {
                refused = true;
                break;
              }
              cause = cause.cause;
            }
            if (!refused) throw error;
          }
          const [counts] =
            await owner`select (select count(*)::int from ballots where round_id=${roundId}) as ballots,(select count(*)::int from round_commands where round_id=${roundId} and type='submit_ballot') as commands,(select count(*)::int from ballot_screenings) as screenings`;
          assert({
            given: 'the screening write fails inside genuine submission',
            should: 'roll back the ballot, receipt and screening together',
            actual: [refused, counts],
            expected: [true, { ballots: 0, commands: 0, screenings: 0 }],
          });
          await owner.unsafe(
            'drop trigger reject_test_screening on ballot_screenings',
          );
          await owner.unsafe('drop function reject_test_screening()');
        },
      },
      async ({ ballotId, roundId, replay }) => {
        const read = () =>
          owner`select b.reason,s.status,s.rule_set_version,s.released_text,s.screened_at,s.created_at,s.updated_at from ballots b join ballot_screenings s on s.ballot_id=b.id where b.id=${ballotId}`;
        const [row] = await read();
        assert({
          given:
            'a genuine submitted ballot with an email and the event default hold',
          should:
            'retain private original and atomically store the v1 held disposition',
          actual: [
            row!.reason,
            row!.status,
            row!.rule_set_version,
            row!.released_text,
            !!row!.screened_at,
          ],
          expected: [written.reason, 'held', 'contact-v1', null, true],
        });
        const receipt = await replay();
        assert({
          given: 'the identical ordinary submission replay',
          should: 'retain its exact original screening row and ballot',
          actual: [receipt.ballotId, await read()],
          expected: [ballotId, [row]],
        });
        const lobbyId = world.made.get('tournament-lobby')!,
          eventId = world.made.get('event')!;
        const common = {
          store: createTabStore(committingRuntimeTestDatabase(owner)),
          authorize,
          newId: createId,
          now: () => new Date().toISOString(),
        };
        const complete = completionCommand(common),
          record = eventResultCommand(common),
          principal = as(world.bots.Director!);
        const [fixture] =
          await owner`select f.id,f.version from fixtures f join rounds r on r.room_id=f.room_id where r.id=${roundId}`;
        const captured = await record(principal, lobbyId, {
          version: 1,
          commandId: createId(),
          expected: { fixture: Number(fixture!.version) },
          command: {
            type: 'record-decided-result',
            fixtureId: String(fixture!.id),
          },
        });
        if (captured.kind !== 'accepted')
          throw new Error(`Actual contact result: ${JSON.stringify(captured)}`);
        const certificate = {
          version: 1,
          commandId: createId(),
          expected: { results: 2 },
          command: {
            type: 'certify-result',
            resultId: captured.receipt.aggregate.id,
          },
        };
        assert({
          given: 'a real retained result whose written ballot is held',
          should: 'refuse certification without adding a certificate',
          actual: await complete(principal, lobbyId, certificate),
          expected: { kind: 'refused', refusal: 'screening-pending' },
        });
        const disposition = {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'resolve-screening-hold',
            ballotId,
            release: {
              kind: 'redacted',
              text: { reason: 'Email [contact removed] for feedback' },
            },
          },
        };
        assert({
          given:
            'a non-host requesting the exact private screening disposition',
          should: 'conceal it',
          actual: await deniedAsNotFound(() =>
            complete(as(world.bots['Debater 1']!), lobbyId, disposition),
          ),
          expected: true,
        });
        const form = new FormData();
        form.set('mode', 'redacted');
        form.set('reason', 'Email [contact removed] for feedback');
        const envelope = completionEnvelope(
          {
            commandId: disposition.commandId,
            lobbyId,
            eventId,
            handle: 'actual-tournament',
            target: {
              type: 'resolve-screening-hold',
              ballotId,
              roundId,
              feedbackKeys: [],
            },
          },
          form,
        );
        const submit = (released: boolean) =>
          createTabCommandRoute({
            boundary: {
              logger: silentLogger,
              reporter: noopErrorReporter,
              origin: () => origin,
              identify: async () => ({
                ...member,
                principal: {
                  ...principal,
                  actorId: world.bots.Director!.actorId,
                },
              }),
            },
            released: async () => released,
            name: 'tab.result.command',
            address: 'lobby',
            execute: record,
          })(
            new Request(
              `${origin}/api/tab/result-command?${new URLSearchParams({ lobbyId })}`,
              {
                method: 'POST',
                headers: { origin, 'content-type': 'application/json' },
                body: JSON.stringify(envelope),
              },
            ),
          );
        assert({
          given: 'the actual held-text form while the Tab release is closed',
          should:
            'refuse at the real request boundary without resolving the hold',
          actual: [(await submit(false)).status, (await read())[0]!.status],
          expected: [404, 'held'],
        });
        const response = await submit(true);
        const result = completionAnswer(form, await response.json());
        assert({
          given:
            'the reviewed text submitted through the production event-result dispatcher and evaluated HTTP boundary',
          should:
            'acknowledge the real retained receipt without caching private text',
          actual: [
            response.status,
            response.headers.get('cache-control'),
            result.kind,
          ],
          expected: [200, 'no-store', 'accepted'],
        });
        const [settled] = await read();
        const [audit] =
          await owner`select actor_user_id,type from action_history where command_id=${disposition.commandId}`;
        assert({
          given: 'an actual host redaction disposition',
          should:
            'audit the human and retain immutable original plus the actual contact rule version',
          actual: [
            settled!.reason,
            settled!.status,
            settled!.rule_set_version,
            settled!.released_text,
            audit!.actor_user_id,
            audit!.type,
          ],
          expected: [
            written.reason,
            'clear',
            'contact-v1',
            { reason: 'Email [contact removed] for feedback' },
            principal.userId,
            'resolve-screening-hold',
          ],
        });
        await owner.unsafe(
          `create function reject_test_certificate() returns trigger language plpgsql as $$ begin raise exception 'certificate failure witness'; end $$`,
        );
        await owner.unsafe(
          'create trigger reject_test_certificate before insert on certification_results for each row execute function reject_test_certificate()',
        );
        let failed = false;
        try {
          await complete(principal, lobbyId, certificate);
        } catch (error) {
          let cause: unknown = error;
          while (cause instanceof Error) {
            if (cause.message.includes('certificate failure witness')) {
              failed = true;
              break;
            }
            cause = cause.cause;
          }
          if (!failed) throw error;
        }
        const [rollback] =
          await owner`select (select count(*)::int from certifications where event_id=${eventId}) as certificates,(select count(*)::int from action_history where command_id=${certificate.commandId}) as receipts`;
        assert({
          given: 'failure while writing exact certified source rows',
          should: 'roll back certification and receipt together',
          actual: [failed, rollback],
          expected: [true, { certificates: 0, receipts: 0 }],
        });
        await owner.unsafe(
          'drop trigger reject_test_certificate on certification_results',
        );
        await owner.unsafe('drop function reject_test_certificate()');
        const certified = await complete(principal, lobbyId, certificate);
        if (certified.kind !== 'accepted')
          throw new Error(`Contact certificate: ${JSON.stringify(certified)}`);
        assert({
          given: 'clear screened text and the original retained result guard',
          should:
            'certify once and replay the retained receipt after its guard advances',
          actual: [
            certified.receipt.resultingVersion,
            await complete(principal, lobbyId, certificate),
          ],
          expected: [
            3,
            { ...certified, receipt: { ...certified.receipt, replayed: true } },
          ],
        });
        assert({
          given: 'a new command with the old pre-certification guard',
          should: 'refuse stale results without writing',
          actual: await complete(principal, lobbyId, {
            ...certificate,
            commandId: createId(),
          }),
          expected: { kind: 'refused', refusal: 'version-conflict' },
        });
      },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
