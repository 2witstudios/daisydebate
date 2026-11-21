import { seedGuardianLink } from './guardian-link.test-support';
import { requireTestServices } from '@daisy/config';
import { decideRoundFloor } from '@daisy/auth/round-floor';
import { rejectionOf } from '@daisy/errors/testing';
import { captureRule } from '@daisy/debate-engine';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { contextChatFence } from '../src/features/messaging/context-chat/authority';
import { canReadTranscript } from '../src/features/round-runtime/reads';
import { withLinkedAdults } from '../src/features/spectating/linked-adults';
import { readyRankedRoom } from './ranked-room.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import {
  schoolWithCoach,
  setAge,
  withLinks,
  withYouthSeason,
  type Fixture,
  type Member,
} from './youth-round.test-support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * YLS-7, ADR 0155: a youth debater's linked coach or parent watches their
 * live Youth Round undelayed (timing, transcript, floor chat read-only, no
 * media), through the same people read and row-level security as the
 * Recording's audience. Nobody else outside the Round does, and an Open Round
 * and a seated debater are as they were.
 */
const callerOf = (member: Member) => ({
  userId: member.userId,
  actorId: member.actorId,
});

const adults = async (f: Fixture) => {
  const made = {
    coach: await f.member(),
    otherCoach: await f.member(),
    owner: await f.member(),
    stranger: await f.member(),
    otherStudent: await f.member(),
  };
  for (const adult of [made.coach, made.otherCoach, made.owner, made.stranger])
    await setAge(f, adult, '40 years');
  await setAge(f, made.otherStudent, '15 years');
  return made;
};

/** The host and guest debate it, the outsider judges; ages decide the ladder. */
const liveRound = async (f: Fixture, debaterAge: string) => {
  await setAge(f, f.host, debaterAge);
  await setAge(f, f.guest, debaterAge);
  await setAge(f, f.outsider, '30 years');
  const room = await readyRankedRoom(f, 'freestyle', 'human');
  const { roundId } = await launchRuntimeRound(f, room);
  return { roomId: room.id, roundId };
};

const watches = async (f: Fixture, member: Member, roundId: string) => {
  const read = await f
    .roundView(callerOf(member), roundId)
    .then((view) => view.viewerWatchesAs === 'linked_adult')
    .catch((error: { code?: string }) => error.code ?? 'error');
  return read;
};

const transcript = (f: Fixture, member: Member, roundId: string) =>
  withLinkedAdults(
    callerOf(member),
    roundId,
    f.linkedAdults,
    (youth, refused) =>
      f.store.readRoundTranscript({
        caller: callerOf(member),
        roundId,
        captureRule,
        readEventDecision: () => false,
        authorize: (round, account, authority) => {
          const allowed = canReadTranscript(
            callerOf(member),
            round,
            account,
            authority,
            youth,
          );
          if (!allowed) refused();
          return allowed;
        },
      }),
  ).then(
    () => 'read',
    (error: { code?: string }) => error.code ?? 'error',
  );

const floorOf = async (f: Fixture, member: Member, roundId: string) => {
  const caller = callerOf(member);
  return f.store.roundFloorStore(
    contextChatFence(
      caller,
      ({ fact, account, action }) =>
        decideRoundFloor({
          principal: caller,
          fact: fact as never,
          account: account as never,
          action,
          now: new Date().toISOString(),
        }).allow,
    ),
    await f.linkedAdults(roundId),
  );
};

test('a live Youth Round is watched by its debaters’ linked adults and nobody else outside it', async () => {
  await withRoomRuntime(async (f) =>
    withYouthSeason(f, () =>
      withLinks(f, async (made) => {
        const people = await adults(f);
        const { roomId, roundId } = await liveRound(f, '16 years');
        const school = await schoolWithCoach(f, made, {
          owner: people.owner,
          coach: people.coach,
          student: f.host,
        });
        // Another school's coach, whose student is not in this Round.
        await schoolWithCoach(f, made, {
          owner: people.owner,
          coach: people.otherCoach,
          student: people.otherStudent,
        });

        assert({
          given:
            "a live Youth Round, the host's school coach and its owner, another student's coach, a stranger and the seated debater",
          should:
            'let the coach and owner watch undelayed, refuse the others as missing, and leave the debater reading through their seat',
          actual: {
            coach: await watches(f, people.coach, roundId),
            schoolOwner: await watches(f, people.owner, roundId),
            otherCoach: await watches(f, people.otherCoach, roundId),
            stranger: await watches(f, people.stranger, roundId),
            debater: await watches(f, f.host, roundId),
          },
          expected: {
            coach: true,
            schoolOwner: true,
            otherCoach: 'NOT_FOUND',
            stranger: 'NOT_FOUND',
            debater: false,
          },
        });

        assert({
          given: 'the same people reading the live transcript',
          should: 'let the coach and the debater read it, and nobody else',
          actual: [
            await transcript(f, people.coach, roundId),
            await transcript(f, f.host, roundId),
            await transcript(f, people.otherCoach, roundId),
            await transcript(f, people.stranger, roundId),
          ],
          expected: ['read', 'read', 'NOT_FOUND', 'NOT_FOUND'],
        });

        const room = (member: Member) =>
          f.operations.view(callerOf(member), roomId).then(
            (view) => view.watch,
            () => 'refused',
          );
        assert({
          given: 'the Room read after Start, by the coach and the stranger',
          should:
            "point the coach to the Round's live room and the stranger nowhere",
          actual: [await room(people.coach), await room(people.stranger)],
          expected: [{ kind: 'live_room', roundId }, null],
        });

        assert({
          given: "Watch's student list for the coach and for the stranger",
          should: 'propose the Round for the coach only',
          actual: [
            (await f.store.readStudentLiveRounds(people.coach.userId)).map(
              (each) => each.roundId,
            ),
            await f.store.readStudentLiveRounds(people.stranger.userId),
          ],
          expected: [[roundId], []],
        });

        const debaterFloor = await floorOf(f, f.host, roundId);
        await debaterFloor.open({
          roundId,
          ...callerOf(f.host),
          newChannelId: createId(),
        });
        const coachFloor = await floorOf(f, people.coach, roundId);
        const strangerFloor = await floorOf(f, people.stranger, roundId);
        const seen = await coachFloor.discover({
          roundId,
          ...callerOf(people.coach),
        });
        assert({
          given: "the Round's floor chat, opened by a debater",
          should:
            'let the coach read it read-only, refuse their post, and show the stranger nothing',
          actual: {
            coachReadOnly: seen?.readOnly ?? null,
            coachPost: (
              await rejectionOf(() =>
                coachFloor.withFloor(
                  {
                    roundId,
                    ...callerOf(people.coach),
                    channelId: seen!.channelId,
                    action: 'post',
                  },
                  // The send path's own check, as a post runs it.
                  (frame) => frame.authorize(),
                ),
              )
            )?.code,
            stranger: (
              await rejectionOf(() =>
                strangerFloor.discover({
                  roundId,
                  ...callerOf(people.stranger),
                }),
              )
            )?.code,
          },
          expected: {
            coachReadOnly: true,
            coachPost: 'AUTHORIZATION',
            stranger: 'NOT_FOUND',
          },
        });

        // A parent with an active guardian link to the other youth debater.
        const parent = await f.member();
        await setAge(f, parent, '42 years');
        made.users.push(parent.userId);
        await seedGuardianLink(f.sql, parent.userId, f.guest.userId);
        const parentFloor = await floorOf(f, parent, roundId);
        assert({
          given:
            'a parent linked to the guest debater by an active guardian link',
          should:
            'watch undelayed, read the transcript, find the Round under their students, and read the floor read-only',
          actual: {
            watches: await watches(f, parent, roundId),
            transcript: await transcript(f, parent, roundId),
            candidates: (
              await f.store.readStudentLiveRounds(parent.userId)
            ).map((each) => each.roundId),
            floorReadOnly:
              (await parentFloor.discover({ roundId, ...callerOf(parent) }))
                ?.readOnly ?? null,
          },
          expected: {
            watches: true,
            transcript: 'read',
            candidates: [roundId],
            floorReadOnly: true,
          },
        });

        // A plain member of the student's school, staff of nothing, has no students.
        const classmate = await f.member();
        await setAge(f, classmate, '40 years');
        await f.sql`insert into memberships(organization_id,user_id,status,joined_at)
          values(${school.id},${classmate.userId},'active',now())`;
        assert({
          given: "an adult who only belongs to the student's school",
          should: 'propose no Round and admit them to none',
          actual: [
            await f.store.readStudentLiveRounds(classmate.userId),
            await watches(f, classmate, roundId),
          ],
          expected: [[], 'NOT_FOUND'],
        });

        await f.sql`update grants set revoked_at=now(), revoked_by_user_id=${people.owner.userId} where id=${school.grantId}`;
        assert({
          given: "the coach's roster grant revoked",
          should: 'stop admitting them',
          actual: await watches(f, people.coach, roundId),
          expected: 'NOT_FOUND',
        });

        await f.sql`update rounds set status='completed', current_stage=null, started_at=coalesce(started_at, now()), winning_side='affirmative', completed_at=now() where id=${roundId}`;
        assert({
          given: 'the Round ended, read by its school owner',
          should:
            'refuse the live read and the transcript: the Recording is theirs from then on',
          actual: [
            await watches(f, people.owner, roundId),
            await transcript(f, people.owner, roundId),
          ],
          expected: ['NOT_FOUND', 'NOT_FOUND'],
        });
      }),
    ),
  );
});

test('an Open Round gains no linked adults', async () => {
  await withRoomRuntime(async (f) =>
    withYouthSeason(f, () =>
      withLinks(f, async (made) => {
        const people = await adults(f);
        const { roundId } = await liveRound(f, '30 years');
        await schoolWithCoach(f, made, {
          owner: people.owner,
          coach: people.coach,
          student: f.host,
        });
        const [standing] =
          await f.sql`select l.age_rule from rounds r join lobbies l on l.id=r.rating_lobby_id where r.id=${roundId}`;
        assert({
          given:
            'a live Open Round whose adult debater belongs to a school with a coach',
          should:
            'refuse the coach as for any member outside it, and keep the host and debater as they were',
          actual: {
            ageRule: standing!.age_rule,
            coach: await watches(f, people.coach, roundId),
            debater: await watches(f, f.host, roundId),
            linked: await f.linkedAdults(roundId),
          },
          expected: {
            ageRule: 'adults',
            coach: 'NOT_FOUND',
            debater: false,
            linked: null,
          },
        });
      }),
    ),
  );
});

test('a casual Youth Room’s live Round has its debaters’ linked adults too (ADR 0156)', async () => {
  await withRoomRuntime(async (f) =>
    withLinks(f, async (made) => {
      const people = await adults(f);
      await setAge(f, f.host, '15 years');
      await setAge(f, f.guest, '16 years');
      const [lobby] =
        await f.sql`select id from lobbies where age_rule='under-18' and kind='standing'`;
      const room = await f.assemble({ lobby: lobby!.id });
      const { roundId } = await launchRuntimeRound(f, room);
      await schoolWithCoach(f, made, {
        owner: people.owner,
        coach: people.coach,
        student: f.host,
      });
      const [row] =
        await f.sql`select r.competition_type, public.daisy_room_is_youth(rm.id) as youth from rounds r join rooms rm on rm.id=r.room_id where r.id=${roundId}`;
      assert({
        given:
          'a live casual Round in a Youth Room, read by the host’s coach and a stranger',
        should:
          'read as a Youth Round by its Room, propose it to the coach and admit them, and nobody else',
        actual: {
          room: [row!.competition_type, row!.youth],
          youth: await f.store.readRoundYouth(roundId),
          candidates: (
            await f.store.readStudentLiveRounds(people.coach.userId)
          ).map((each) => each.roundId),
          coach: await watches(f, people.coach, roundId),
          stranger: await watches(f, people.stranger, roundId),
        },
        expected: {
          room: ['casual', true],
          youth: true,
          candidates: [roundId],
          coach: true,
          stranger: 'NOT_FOUND',
        },
      });
    }),
  );
});
