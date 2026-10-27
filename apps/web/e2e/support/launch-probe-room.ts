import { foundationChoice, humanRoundSelection } from './human-round-selection';
import { createId } from '@paralleldrive/cuid2';
import {
  roomViewSchema,
  roundViewSchema,
  attendanceReceiptSchema,
  type RoomView,
  type RoundView,
} from '@daisy/protocol';
import { createPublicCheckInProbe } from '../../src/features/availability/public-probe';
import {
  createLaunchProbeMember,
  type LaunchProbeMember,
} from './launch-probe-member';

const probeRequests = (origin: string) => {
  const json = async (
    member: LaunchProbeMember,
    path: string,
    body?: object,
  ) => {
    const response = await fetch(`${origin}${path}`, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: {
        origin,
        cookie: member.cookie,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Public probe Round setup refused');
    return response.json();
  };
  return json;
};
type ProbeRequests = ReturnType<typeof probeRequests>;
async function createProbeRoom(
  json: ProbeRequests,
  members: readonly LaunchProbeMember[],
) {
  const created = await json(members[0]!, '/api/rooms', {
    commandId: createId(),
    title: 'Public ingress receipt resource',
    topic: 'Cities should fund transit',
    visibility: 'public',
    selection: humanRoundSelection(foundationChoice, 1),
  });
  let room = roomViewSchema.parse(created.view);
  const roomCommand = async (
    member: LaunchProbeMember,
    command: object,
    view: RoomView = room,
  ) => {
    const response = await json(member, `/api/rooms/${view.id}/commands`, {
      ...command,
      commandId: createId(),
      expectedVersion: view.version,
    });
    room = roomViewSchema.parse(response.view);
  };
  const roles = ['affirmative', 'negative', 'judge'] as const;
  for (const [index, member] of members.entries())
    await roomCommand(member, {
      type: 'claim-seat',
      role: roles[index],
      slot: 0,
    });
  for (const [index, member] of members.entries()) {
    const own = roomViewSchema.parse(
      await json(member, `/api/rooms/${room.id}`),
    );
    const seat = own.participants.find(
      (seat) => seat.role === roles[index] && 'consentVersion' in seat,
    );
    if (!seat || !('consentVersion' in seat))
      throw new Error('Public probe own consent missing');
    await roomCommand(
      member,
      { type: 'ready', expectedConsentVersion: seat.consentVersion },
      own,
    );
  }
  await roomCommand(members[0]!, { type: 'start-round' });
  return room;
}
async function endProbeSpeeches(
  json: ProbeRequests,
  members: readonly LaunchProbeMember[],
  roundId: string,
) {
  const roles = ['affirmative', 'negative'] as const;
  await json(members[0]!, `/api/rounds/${roundId}/media/session`, {});
  const read = async () => {
    await json(members[0]!, `/api/rounds/${roundId}/media/reconcile`, {});
    return roundViewSchema.parse(
      await json(members[0]!, `/api/rounds/${roundId}`),
    );
  };
  let round = await read();
  const command = async (
    member: LaunchProbeMember,
    view: RoundView,
    body: object,
  ) => {
    const response = await json(member, `/api/rounds/${roundId}/commands`, {
      version: 1,
      commandId: createId(),
      expectedVersion: view.version,
      command: body,
    });
    return roundViewSchema.parse(response.view);
  };
  round = await command(members[0]!, round, { type: 'start' });
  for (let sequence = 0; sequence < 2; sequence++) {
    const deadline = performance.now() + 10000;
    while (!round.segments[sequence]) {
      if (performance.now() >= deadline)
        throw new Error('Public probe actual segment opening deadline');
      await Bun.sleep(10);
      round = await read();
    }
    const segment = round.segments[sequence]!;
    // Every prior adjudicable speech receives ordinary durable receipts before it is yielded.
    for (const member of members.slice(0, 2))
      attendanceReceiptSchema.parse(
        await json(member, `/api/rounds/${roundId}/check-in`, {
          version: 1,
          commandId: createId(),
          segmentId: segment.id,
        }),
      );
    round = await read();
    const speaker = round.participants.find(
      (seat) => seat.role === roles[sequence] && 'id' in seat,
    );
    if (!speaker || !('id' in speaker))
      throw new Error('Public probe actual speaker missing');
    round = await command(members[sequence]!, round, {
      type: 'yield',
      participantId: speaker.id,
    });
  }
  return read();
}
const probeTarget = (round: RoundView) => {
  const last = round.segments.at(-1),
    participant = round.participants.find(
      (seat) => seat.role === 'negative' && 'id' in seat,
    );
  if (
    round.status !== 'active' ||
    round.segments.length !== 2 ||
    !last?.endedAt ||
    !participant ||
    !('id' in participant)
  )
    throw new Error(
      'Public probe last-speech resource is not awaiting its human ballot',
    );
  return { segmentId: last.id, participantId: participant.id };
};
/** A real last-speech resource with actual on-time receipts, not prefilled attendance facts. */
export async function createLaunchProbeResource(
  origin: string,
  mailPort: number,
) {
  const members: LaunchProbeMember[] = [];
  for (let index = 0; index < 3; index++)
    members.push(await createLaunchProbeMember(origin, mailPort));
  const json = probeRequests(origin);
  const room = await createProbeRoom(json, members);
  const roundId = room.roundRef?.id;
  if (!roundId) throw new Error('Public probe committed Round missing');
  const round = await endProbeSpeeches(json, members, roundId);
  const target = probeTarget(round);
  const configuration = {
    origin,
    roundId,
    ...target,
    cookie: members[1]!.cookie,
  };
  const probe = createPublicCheckInProbe({
    configuration,
    nextId: createId,
    nowMs: () => performance.now(),
    fetch,
  });
  if (!(await probe()))
    throw new Error('Public probe resource failed its real receipt check');
  return configuration;
}
