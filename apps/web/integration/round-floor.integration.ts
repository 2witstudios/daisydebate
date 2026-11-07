import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { roundViewSchema } from '@daisy/protocol';
import {
  createRoomHttpFixture,
  withHumanJudgeHttpRound,
} from './room-http.test-support';
import { withSql } from './fixtures';
import { createAccountFlows } from './auth-account-helpers';

setupRitewayBun();
const h = createRoomHttpFixture();

test('real floor HTTP binds debaters and host, denies judges, and retains read-only history after forfeit', async () => {
  const host = await h.member(),
    guest = await h.member(),
    judge = await h.member(),
    outsider = await h.member();
  await withHumanJudgeHttpRound(
    h,
    { host, guest, judges: [judge], countdownMs: 10_000 },
    async ({ roundId }) => {
      const path = `/api/rounds/${roundId}/floor`;
      const post = (
        cookie: string,
        kind: 'open' | 'send' | 'edit' | 'remove' | 'markRead' | 'report',
        body: object,
      ) =>
        h.routes.roundFloor[kind](
          h.f.jsonPost(path + (kind === 'open' ? '' : '/messages'), body, {
            cookie,
          }),
          roundId,
        );
      const discover = await h.routes.roundFloor.discover(
        new Request(h.f.origin + path, { headers: h.headers(host) }),
        roundId,
      );
      assert({
        given: 'a live Round before floor use',
        should: 'authorize discovery without creating a channel',
        actual: await discover.json(),
        expected: { version: 1, roundId, channel: null },
      });
      const [firstOpen, secondOpen] = await Promise.all([
        post(host, 'open', { version: 1, roundId }),
        post(guest, 'open', { version: 1, roundId }),
      ]);
      const metadata = await firstOpen.json();
      const second = await secondOpen.json();
      assert({
        given: 'two authorized accounts opening the same floor',
        should: 'receive one durable live channel',
        actual: [
          firstOpen.status,
          secondOpen.status,
          metadata.channelId === second.channelId,
          metadata.readOnly,
        ],
        expected: [200, 200, true, false],
      });
      const channelId = metadata.channelId as string;
      const command = {
        version: 1,
        channelId,
        requestId: createId(),
        text: 'Host floor message',
      };
      const sent = await post(host, 'send', command);
      const message = await sent.json();
      const repeated = await post(host, 'send', command);
      const guestMessage = await post(guest, 'send', {
        ...command,
        requestId: createId(),
        text: 'Debater reply',
      });
      assert({
        given: 'an accepted command, retry and another author',
        should: 'send each message once and preserve retry identity',
        actual: [
          sent.status,
          repeated.status,
          (await repeated.json()).id,
          guestMessage.status,
        ],
        expected: [200, 200, message.id, 200],
      });
      const conflict = await post(host, 'send', {
        ...command,
        text: 'Conflicting reuse',
      });
      assert({
        given: 'the same request identity with different text',
        should: 'refuse the conflicting send',
        actual: conflict.status,
        expected: 409,
      });
      const read = (cookie: string) =>
        h.routes.roundFloor.history(
          new Request(`${h.f.origin}${path}/messages?channelId=${channelId}`, {
            headers: h.headers(cookie),
          }),
          roundId,
        );
      const page = await (await read(guest)).json();
      const judgeIdentity = await createAccountFlows(h.f).identifyAs(judge);
      const hiddenJudge =
        judgeIdentity.principal.kind === 'user'
          ? judgeIdentity.principal.actorId
          : null;
      assert({
        given: 'the other debater reading current history',
        should:
          'read both messages with author labels and no hidden judge identity',
        actual: [
          page.history.messages.map((m: { text: string }) => m.text),
          page.authors.length,
          hiddenJudge !== null && JSON.stringify(page).includes(hiddenJudge),
        ],
        expected: [['Debater reply', 'Host floor message'], 2, false],
      });
      assert({
        given: 'a judge and unrelated member',
        should: 'treat floor history as missing',
        actual: [(await read(judge)).status, (await read(outsider)).status],
        expected: [404, 404],
      });
      const older = await h.routes.roundFloor.history(
        new Request(
          `${h.f.origin}${path}/messages?channelId=${channelId}&limit=1&before=2`,
          { headers: h.headers(guest) },
        ),
        roundId,
      );
      assert({
        given: 'a bound older-page cursor',
        should: 'read only the earlier message',
        actual: (await older.json()).history.messages.map(
          (m: { id: string }) => m.id,
        ),
        expected: [message.id],
      });
      const marked = await post(guest, 'markRead', {
        version: 1,
        channelId,
        cursor: { channelId, sequence: 2 },
      });
      assert({
        given: 'a real visible-history read marker',
        should: 'persist the caller cursor',
        actual: [
          marked.status,
          (await (await read(guest)).json()).history.viewer.readSequence,
        ],
        expected: [200, 2],
      });
      const reported = await post(guest, 'report', {
        version: 1,
        channelId,
        messageId: message.id,
        reason: 'harassment',
      });
      const selfReport = await post(host, 'report', {
        version: 1,
        channelId,
        messageId: message.id,
        reason: 'harassment',
      });
      assert({
        given: 'a peer report and a self report',
        should: 'accept only the peer safety report',
        actual: [reported.status, selfReport.status],
        expected: [200, 404],
      });
      await withSql(async (sql) => {
        await sql`delete from content_reports where target_id=${message.id}`;
      });
      const edited = await post(host, 'edit', {
        version: 1,
        channelId,
        requestId: createId(),
        messageId: message.id,
        text: 'Corrected host text',
      });
      assert({
        given: 'an author inside the normal edit window',
        should: 'edit their own floor message',
        actual: edited.status,
        expected: 200,
      });
      const current = roundViewSchema.parse(
        await (
          await h.routes.rounds.read(
            new Request(`${h.f.origin}/api/rounds/${roundId}`, {
              headers: h.headers(host),
            }),
            roundId,
          )
        ).json(),
      );
      const seat = current.participants.find((p) => p.role === 'affirmative');
      if (!seat || 'anonymous' in seat)
        throw Error('Expected own debater seat');
      const ended = await h.routes.rounds.commands(
        h.f.jsonPost(
          `/api/rounds/${roundId}/commands`,
          {
            version: 1,
            commandId: createId(),
            expectedVersion: current.version,
            command: { type: 'forfeit', participantId: seat.id },
          },
          { cookie: host },
        ),
        roundId,
      );
      assert({
        given: 'an explicit forfeit',
        should: 'complete the ordinary Round transition',
        actual: ended.status,
        expected: 200,
      });
      const retained = await (await read(guest)).json();
      const closedPost = await post(host, 'send', {
        ...command,
        requestId: createId(),
        text: 'After end',
      });
      assert({
        given: 'the terminal Round',
        should: 'retain original-audience history and refuse new posts',
        actual: [
          retained.metadata.readOnly,
          Boolean(retained.metadata.expiresAt),
          retained.history.messages.length,
          closedPost.status,
        ],
        expected: [true, true, 2, 403],
      });
      const removal = {
        version: 1,
        channelId,
        messageId: message.id,
        requestId: createId(),
      };
      const removed = await post(host, 'remove', removal);
      const retriedRemoval = await post(host, 'remove', removal);
      assert({
        given: 'a removal whose response was lost',
        should: 'acknowledge its exact retry without resurrecting text',
        actual: retriedRemoval.status,
        expected: 200,
      });
      assert({
        given: 'the original author after the Round ends',
        should: 'allow withdrawal while keeping peer history available',
        actual: [
          removed.status,
          (await (await read(guest)).json()).history.messages.find(
            (m: { id: string }) => m.id === message.id,
          )?.unavailable,
        ],
        expected: [200, true],
      });
    },
  );
});
