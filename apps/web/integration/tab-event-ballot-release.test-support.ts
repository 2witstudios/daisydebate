import { noLinkedAdults } from '../src/features/spectating/linked-adults';
import type { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { committingRuntimeTestDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import {
  captureRule,
  readRoundOpening,
  roundWaitingOn,
} from '@daisy/debate-engine';
import { assert } from 'riteway/bun';
import { eventBallotAccess } from '../src/features/round-ballots/audience';
import {
  canReadRound,
  canReadTranscript,
  roundViewReader,
} from '../src/features/round-runtime/reads';
import { releaseCommand } from '../src/features/tab/operations/release-command';
import { settingCommand } from '../src/features/tab/operations/settings';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { committedEventRoom } from './tab-event-room-direction.test-support';
import type { withRoomRuntime } from './room-runtime.test-support';

type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
/** A genuine submitted custom ballot through recorded manual openings and the ordinary read endpoints. */
export const proveEventBallotReleases = async (input: {
  readonly f: Runtime;
  readonly owner: SQL;
  readonly world: Awaited<ReturnType<typeof committedEventRoom>>;
  readonly roundId: string;
  readonly competitorActorId: string;
}) => {
  const { f, owner, world, roundId } = input;
  const lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!;
  const [person] =
    await owner`select user_id from actors where id=${input.competitorActorId}`;
  const competitor = {
    actorId: input.competitorActorId,
    userId: String(person!.user_id),
  };
  const director = world.bots.Director!;
  const store = createTabStore(committingRuntimeTestDatabase(owner));
  const settings = settingCommand({
    store,
    authorize,
    now: () => new Date().toISOString(),
    newId: createId,
  });
  const send = releaseCommand({ store, authorize, newId: createId });
  const configure = async (
    thing: 'scores' | 'decision',
    when: 'manual' | 'never',
  ) => {
    const [row] =
      await owner`select version,entries_version,settings_version from events where id=${eventId}`;
    const answer = await settings(as(director), {
      version: 1,
      commandId: createId(),
      expected: {
        event: Number(row!.version),
        entries: Number(row!.entries_version),
        settings: Number(row!.settings_version),
      },
      command: {
        type: 'set-setting',
        scope: { kind: 'event', id: eventId },
        key: `audience.${thing}`,
        hold: 'default',
        value: {
          responsible_adults: when,
          competitors: when,
          participants: when,
          link: 'never',
          public: 'never',
        },
      },
    });
    if (answer.kind !== 'accepted')
      throw new Error(
        `Audience configuration refused: ${JSON.stringify(answer)}`,
      );
  };
  const read = () =>
    f.store.readRoundBallot({
      caller: competitor,
      roundId,
      captureRule,
      readOpening: readRoundOpening,
      decideWaitingOn: roundWaitingOn,
      authorize: (r, a, owner) => canReadRound(competitor, r, a, owner),
      authorizeTranscript: (r, a, owner) =>
        canReadTranscript(competitor, r, a, owner),
      ballotAccess: (_r, _a, owner) => eventBallotAccess(competitor, owner),
    });
  await configure('scores', 'manual');
  await configure('decision', 'manual');
  const closed = await read();
  assert({
    given:
      'a completed custom event Round whose caller is seated but no ballot parts have opened',
    should:
      'return no other ballot and no aggregate outcome from either ordinary endpoint',
    actual: [
      closed.ballots,
      closed.round.outcome,
      (await roundViewReader(f.store, noLinkedAdults)(competitor, roundId)).outcome,
    ],
    expected: [[], null, null],
  });
  const envelope = (
    thing: 'scores' | 'decision',
    audience: 'responsible_adults' | 'competitors' | 'participants',
  ) => ({
    version: 1,
    commandId: createId(),
    expected: {},
    command: {
      type: 'open-audience',
      eventId,
      tabRounds: { kind: 'one', tabRoundId: world.made.get('tab-round')! },
      thing,
      audience,
    },
  });
  const outOfOrder = envelope('scores', 'competitors');
  const refused = await send(as(director), lobbyId, outOfOrder);
  assert({
    given: 'an attempted wider opening before its narrower audience',
    should: 'refuse with no release or accepted receipt',
    actual: [
      refused.kind === 'refused' && refused.refusal,
      Number(
        (
          await owner`select count(*)::int n from action_history where command_id=${outOfOrder.commandId}`
        )[0]!.n,
      ),
    ],
    expected: ['audience-order', 0],
  });
  const open = async (thing: 'scores' | 'decision') => {
    const narrow = await send(
      as(director),
      lobbyId,
      envelope(thing, 'responsible_adults'),
    );
    if (narrow.kind !== 'accepted')
      throw new Error(`Narrow release refused: ${JSON.stringify(narrow)}`);
    const command = envelope(thing, 'competitors');
    const accepted = await send(as(director), lobbyId, command);
    if (accepted.kind !== 'accepted')
      throw new Error(
        `Competitor release refused: ${JSON.stringify(accepted)}`,
      );
    const replay = await send(as(director), lobbyId, command);
    return replay.kind === 'accepted' && replay.receipt.replayed;
  };
  const scoresReplay = await open('scores');
  const scores = await read();
  assert({
    given: 'actual append-only score openings and same-command replay',
    should:
      'show scores/speaker ranks while keeping the independent decision and text closed',
    actual: [
      scoresReplay,
      scores.ballots.length,
      scores.ballots[0]?.ballot.scores !== undefined,
      scores.ballots[0]?.ballot.speakerRanks !== undefined,
      scores.ballots[0]?.ballot.winner,
      scores.ballots[0]?.ballot.reason,
      scores.round.outcome,
    ],
    expected: [true, 1, true, true, undefined, undefined, null],
  });
  const decisionReplay = await open('decision');
  await configure('decision', 'never');
  const opened = await read();
  assert({
    given: 'an actual decision opening followed by a setting change to never',
    should:
      'keep the recorded opening on both current Round reads without opening unrelated text',
    actual: [
      decisionReplay,
      opened.ballots[0]?.ballot.winner,
      opened.round.outcome,
      (await roundViewReader(f.store, noLinkedAdults)(competitor, roundId)).outcome,
      opened.ballots[0]?.ballot.reason,
    ],
    expected: [
      true,
      'affirmative',
      { kind: 'winner', side: 'affirmative' },
      { kind: 'winner', side: 'affirmative' },
      undefined,
    ],
  });
};
