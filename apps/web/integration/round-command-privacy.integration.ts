import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isNamedSeat, roundViewSchema } from '@daisy/protocol';
import { submitRoundForm } from '../src/features/round-runtime/command-form';
import {
  createRoomHttpFixture,
  withHumanJudgeHttpRound,
} from './room-http.test-support';
requireTestServices(process.env);
setupRitewayBun();
const http = createRoomHttpFixture();
const { f, routes, headers, member } = http;
test('real authenticated Round responses and JSON and server-action form replays keep hidden judge identity private', async () => {
  const host = await member(),
    guest = await member(),
    judge = await member();
  await withHumanJudgeHttpRound(
    http,
    { host, guest, judges: [judge] },
    async ({ roundId, started, startBody: rawStart }) => {
      const startBody = rawStart as { view: unknown };
      const named = roundViewSchema
        .parse(startBody.view)
        .participants.filter(isNamedSeat)
        .find((p) => p.role === 'judge')!;
      const hidden = [named.id, named.actorId, named.label];
      const own = roundViewSchema.parse(
        await (
          await routes.rounds.read(
            new Request(`${f.origin}/api/rounds/${roundId}`, {
              headers: headers(guest),
            }),
            roundId,
          )
        ).json(),
      );
      const seat = own.participants
        .filter(isNamedSeat)
        .find((p) => p.role === 'negative')!;
      const envelope = {
        version: 1,
        commandId: createId(),
        expectedVersion: own.version,
        command: { type: 'forfeit', participantId: seat.id },
      };
      const post = (body: object = envelope) =>
        routes.rounds.commands(
          f.jsonPost(`/api/rounds/${roundId}/commands`, body, {
            cookie: guest,
          }),
          roundId!,
        );
      const first = await post(),
        retry = await post();
      const firstBody = await first.json(),
        retryBody = await retry.json();
      // The no-JS form reaches the route through the server action's JSON post.
      const form = new FormData();
      for (const [name, value] of Object.entries({
        version: '1',
        commandId: envelope.commandId,
        expectedVersion: String(envelope.expectedVersion),
        type: 'forfeit',
        participantId: seat.id,
        confirmed: 'true',
      }))
        form.set(name, value);
      const native = await submitRoundForm(
        (path, init) =>
          routes.rounds.commands(
            f.jsonPost(path, JSON.parse(String(init.body)), { cookie: guest }),
            roundId!,
          ),
        roundId!,
        form,
      );
      const refused = await post({ ...envelope, commandId: createId() });
      const refusal = await refused.json();
      assert({
        given:
          'a nonhost seated debater, hidden human judge and accepted/replayed/refused shared commands',
        should:
          'return truthful receipts without judge identifiers or names and replay the native form encoding without mutation',
        actual: {
          statuses: [
            started.status,
            first.status,
            retry.status,
            refused.status,
          ],
          versions: [
            firstBody.view.version,
            retryBody.view.version,
            native.view?.version,
            (await f.app.database.getRound(roundId))!.version,
          ],
          replayed: retryBody.receipt.replayed,
          leaks: hidden.filter((value) =>
            JSON.stringify([
              own,
              firstBody,
              retryBody,
              native,
              refusal,
            ]).includes(value),
          ),
          nativeAcknowledged: native.acknowledged,
        },
        expected: {
          statuses: [200, 200, 200, 409],
          versions: [
            own.version + 1,
            own.version + 1,
            own.version + 1,
            own.version + 1,
          ],
          replayed: true,
          leaks: [],
          nativeAcknowledged: true,
        },
      });
    },
  );
});
