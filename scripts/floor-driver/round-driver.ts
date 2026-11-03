import { Room } from '@livekit/rtc-node';
import { createMediaService } from '@daisy/media';
import {
  roomViewSchema,
  roundViewSchema,
  type RoundView,
} from '@daisy/protocol';
import { floorSelection } from './format';
import { newCommandId, type HttpSession } from './http-session';
import type { DriverArgs, DriverTarget } from './target';

type Seat = {
  readonly session: HttpSession;
  readonly role: 'affirmative' | 'negative';
};

const GRANT_TIMEOUT_MS = 15_000;
const OPEN_TIMEOUT_MS = 30_000;

const okBody = (
  answer: { readonly status: number; readonly body: unknown },
  what: string,
  statuses: readonly number[] = [200],
) => {
  if (!statuses.includes(answer.status))
    throw new Error(`${what}: ${answer.status}`);
  return answer.body;
};

/** From a member's empty Room to a started Round, through the real commands. */
async function startRound(
  seats: readonly [Seat, Seat],
  input: { readonly countdownMs: number; readonly speeches: number },
) {
  const [host] = seats;
  const created = await host.session.request('room.create', '/api/rooms', {
    json: {
      commandId: newCommandId(),
      title: 'Floor load',
      resolution: { kind: 'custom', text: 'Cities should fund transit' },
      visibility: 'public',
      selection: floorSelection(input),
    },
  });
  let room = roomViewSchema.parse(
    (okBody(created, 'room.create', [201]) as { view: unknown }).view,
  );
  const command = async (seat: Seat, body: object) => {
    const answer = await seat.session.request(
      'room.command',
      `/api/rooms/${room.id}/commands`,
      {
        json: {
          ...body,
          commandId: newCommandId(),
          expectedVersion: room.version,
        },
      },
    );
    room = roomViewSchema.parse(
      (okBody(answer, 'room.command') as { view: unknown }).view,
    );
  };
  for (const seat of seats)
    await command(seat, { type: 'claim-seat', role: seat.role, slot: 0 });
  for (const seat of seats) {
    const own = roomViewSchema.parse(
      okBody(
        await seat.session.request('room.read', `/api/rooms/${room.id}`),
        'room.read',
      ),
    );
    room = own;
    const participant = own.participants.find(
      (entry) =>
        entry.role === seat.role &&
        entry.slot === 0 &&
        'consentVersion' in entry,
    );
    if (!participant || !('consentVersion' in participant))
      throw new Error('Own consent missing');
    await command(seat, {
      type: 'ready',
      expectedConsentVersion: participant.consentVersion,
    });
  }
  await command(host, { type: 'start-round' });
  if (!room.roundRef) throw new Error('Round was not admitted');
  return room.roundRef.id;
}

const readView = async (session: HttpSession, roundId: string) => {
  const answer = await session.request('round.view', `/api/rounds/${roundId}`);
  return {
    view: roundViewSchema.parse(okBody(answer, 'round.view')),
    serverNowMs: answer.serverNowMs,
  };
};
/** How far the server's clock is ahead of this process's; the tightest of three. */
const serverOffset = async (session: HttpSession, roundId: string) => {
  let best = { roundTripMs: Infinity, offsetMs: 0 };
  for (let sample = 0; sample < 3; sample += 1) {
    const sentAt = Date.now();
    const { serverNowMs } = await readView(session, roundId);
    const receivedAt = Date.now();
    if (serverNowMs !== null && receivedAt - sentAt < best.roundTripMs)
      best = {
        roundTripMs: receivedAt - sentAt,
        offsetMs: serverNowMs - (sentAt + receivedAt) / 2,
      };
  }
  return best.offsetMs;
};
const openSpeech = (view: RoundView) => {
  const last = view.segments.at(-1);
  return view.status === 'active' &&
    last?.endedAt === null &&
    last.type === 'speech'
    ? last
    : null;
};
const waitForOpenSpeech = async (session: HttpSession, roundId: string) => {
  const until = Date.now() + OPEN_TIMEOUT_MS;
  while (Date.now() < until) {
    const { view } = await readView(session, roundId);
    if (view.status !== 'active' && view.status !== 'opening') return view;
    if (openSpeech(view)) return view;
    await Bun.sleep(100);
  }
  throw new Error('No speech opened');
};
const seatIdOf = (view: RoundView, role: Seat['role']) => {
  const seat = view.participants.find(
    (entry) => entry.role === role && 'id' in entry,
  );
  if (!seat || !('id' in seat)) throw new Error('Seat missing');
  return seat.id;
};

/** A real LiveKit participant: it holds a seat and the grant under measure. */
async function joinSeat(seat: Seat, roundId: string, target: DriverTarget) {
  const admission = okBody(
    await seat.session.request(
      'media.session',
      `/api/rounds/${roundId}/media/session`,
      { json: {} },
    ),
    'media.session',
  ) as { identity: string; token: string; url: string };
  const room = new Room();
  await room.connect(target.seatUrl ?? admission.url, admission.token, {
    autoSubscribe: true,
    dynacast: false,
  });
  const claims = JSON.parse(
    Buffer.from(admission.token.split('.')[1]!, 'base64url').toString(),
  ) as { video: { room: string } };
  return {
    identity: admission.identity,
    roomName: claims.video.room,
    close: () => room.disconnect(),
  };
}

/**
 * One Round, its speeches ended by yields, each boundary measured from the
 * committed instant to LiveKit first showing the next speaker's grant. `live`
 * seats read as a browser does: on each view and at each boundary. `held` seats
 * never read media, so only the recovery tick or capture can move the floor.
 */
export async function driveRound(input: {
  readonly seats: readonly [Seat, Seat];
  readonly target: DriverTarget;
  readonly args: DriverArgs;
  readonly speeches: number;
  /** A browser holds the seats: admit, read and check in nothing here. */
  readonly seatsHeldElsewhere?: {
    readonly open: (roundId: string) => Promise<{
      readonly identities: Readonly<Record<Seat['role'], string>>;
      readonly roomName: string;
      readonly close: () => Promise<void>;
    }>;
  };
  readonly shouldStop: () => boolean;
  readonly deadline: (ms: number) => void;
  readonly miss: () => void;
}): Promise<string | null> {
  const { seats, target, args } = input;
  const liveKit = createMediaService({ config: target.liveKit });
  const roundId = await startRound(seats, {
    countdownMs: args.countdownMs,
    speeches: input.speeches,
  });
  const [first, second] = seats;
  const browserless = !input.seatsHeldElsewhere;
  type Joined = Awaited<ReturnType<typeof joinSeat>>;
  type Held = Awaited<
    ReturnType<NonNullable<typeof input.seatsHeldElsewhere>['open']>
  >;
  let held: Held | null = null;
  const joined: Joined[] = [];
  const identityOf = (role: Seat['role']) =>
    held
      ? held.identities[role]
      : joined[role === first.role ? 0 : 1]!.identity;
  const checkedIn = new Set<string>();
  const checkIn = async (segmentId: string) => {
    if (!browserless || checkedIn.has(segmentId)) return;
    checkedIn.add(segmentId);
    await Promise.all(
      seats.map((seat) =>
        seat.session.request(
          'attendance.check-in',
          `/api/rounds/${roundId}/check-in`,
          { json: { version: 1, commandId: newCommandId(), segmentId } },
        ),
      ),
    );
  };
  // Never awaited by the Round's own step, as a browser's read is not, and a
  // transport failure is only a read that did not arrive.
  const read = () =>
    browserless && args.profile === 'live'
      ? Promise.all(
          seats.map((seat) =>
            seat.session
              .request(
                'media.reconcile',
                `/api/rounds/${roundId}/media/reconcile`,
                { json: {} },
              )
              .catch(() => null),
          ),
        )
      : Promise.resolve([]);
  let failure: string | null = null;
  try {
    if (input.seatsHeldElsewhere)
      held = await input.seatsHeldElsewhere.open(roundId);
    else {
      joined.push(await joinSeat(first, roundId, target));
      joined.push(await joinSeat(second, roundId, target));
    }
    const roomName = held ? held.roomName : joined[0]!.roomName;
    const offsetMs = await serverOffset(first.session, roundId);
    let view = await waitForOpenSpeech(first.session, roundId);
    while (!input.shouldStop()) {
      const speech = openSpeech(view);
      if (!speech) break;
      const speakingRole = view.rules.segments[speech.sequence]?.side as
        Seat['role'] | undefined;
      const speaker = seats.find((seat) => seat.role === speakingRole);
      if (!speaker) throw new Error('Open speech has no seat');
      const next = seats.find((seat) => seat !== speaker)!;
      const lastSpeech = speech.sequence + 1 >= input.speeches;
      await checkIn(speech.id);
      void read();
      await Bun.sleep(args.holdMs);
      const yielded = await speaker.session.request(
        'round.command',
        `/api/rounds/${roundId}/commands`,
        {
          json: {
            version: 1,
            commandId: newCommandId(),
            expectedVersion: (await readView(speaker.session, roundId)).view
              .version,
            command: {
              type: 'yield',
              participantId: seatIdOf(view, speaker.role),
            },
          },
        },
      );
      if (yielded.status === 409) {
        // A tick moved the version under this read; nothing was written.
        view = (await readView(first.session, roundId)).view;
        continue;
      }
      const after = roundViewSchema.parse(
        (okBody(yielded, 'round.command') as { view: unknown }).view,
      );
      if (lastSpeech) break;
      const endedAt = after.segments
        .filter((segment) => segment.endedAt !== null)
        .at(-1)?.endedAt;
      if (!endedAt) throw new Error('Speech end missing');
      const dueAt = Date.parse(endedAt) + args.countdownMs - offsetMs;
      void read();
      const atBoundary = setTimeout(
        () => {
          void Promise.all([
            readView(next.session, roundId).catch(() => null),
            read(),
          ]).catch(() => null);
        },
        Math.max(0, dueAt - Date.now()),
      );
      const wanted = identityOf(next.role);
      const until = Date.now() + GRANT_TIMEOUT_MS;
      let grantedAt: number | null = null;
      while (Date.now() < until) {
        const peers = await liveKit
          .publicationPermissions(roomName)
          .catch(() => []);
        if (
          peers
            .find((peer) => peer.identity === wanted)
            ?.grants.publish.includes('microphone')
        ) {
          grantedAt = Date.now();
          break;
        }
        await Bun.sleep(args.pollMs);
      }
      clearTimeout(atBoundary);
      if (grantedAt === null) input.miss();
      else input.deadline(Math.round(grantedAt - dueAt));
      view = await waitForOpenSpeech(first.session, roundId);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Round failed';
  } finally {
    await settle(first, roundId).catch(() => null);
    await Promise.all(joined.map((seat) => seat.close()));
    await held?.close();
  }
  return failure;
}
/** Leaves no live Round behind: a stopped run forfeits what it still holds. */
async function settle({ session, role }: Seat, roundId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { view } = await readView(session, roundId);
    if (view.status !== 'active' && view.status !== 'opening') return;
    const answer = await session.request(
      'round.command',
      `/api/rounds/${roundId}/commands`,
      {
        json: {
          version: 1,
          commandId: newCommandId(),
          expectedVersion: view.version,
          command: { type: 'forfeit', participantId: seatIdOf(view, role) },
        },
      },
    );
    if (answer.status !== 409) return;
  }
}
