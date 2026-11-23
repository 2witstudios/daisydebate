import { hostWaits } from '@daisy/worker/host';
import { noLinkedAdults } from '../src/features/spectating/linked-adults';
import type { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import {
  committingRuntimeTestDatabase,
  finishedOrBlockedBehind,
} from '@daisy/db/testing';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { roundViewReader } from '../src/features/round-runtime/reads';
import { organizationCommand } from '../src/features/tab/operations/organization';
import {
  as,
  presetStaffRoleId,
} from './tab-tournament-organization-wiring.test-support';
import type { committedEventRoom } from './tab-event-room-direction.test-support';
import type { withRoomRuntime } from './room-runtime.test-support';

type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const denied = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch (error) {
    if (!isAppError(error)) throw error;
    return error.code === 'NOT_FOUND';
  }
};

/** Current read authority uses actual grants, independently of the Room's null host and funding. */
export const proveEventRoundRead = async (input: {
  readonly f: Runtime;
  readonly owner: SQL;
  readonly world: Awaited<ReturnType<typeof committedEventRoom>>;
  readonly roundId: string;
}) => {
  const { f, owner, world, roundId } = input;
  const director = world.bots.Director!,
    stranger = world.bots.Coach!;
  const lobbyId = world.made.get('tournament-lobby')!;
  const read = roundViewReader(f.store, noLinkedAdults);
  const send = organizationCommand({
    store: createTabStore(committingRuntimeTestDatabase(owner)),
    authorize,
    now: () => new Date().toISOString(),
    newId: createId,
  });
  const scope = { kind: 'lobby' as const, lobbyId };
  const expected = async () => ({
    lobby: Number(
      (await owner`select version from lobbies where id=${lobbyId}`)[0]!
        .version,
    ),
  });
  assert({
    given:
      'an actual host-null event Round and the current owner versus a non-seated unrelated adult',
    should:
      'read for current event authority and hide the same Round from the unrelated person',
    actual: [
      (await read(director, roundId)).id,
      await denied(() => read(stranger, roundId)),
    ],
    expected: [roundId, true],
  });
  const granted = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: await expected(),
    command: {
      type: 'give-grant',
      scope,
      userId: stranger.userId,
      roleId: presetStaffRoleId,
      expiresAt: null,
    },
  });
  if (granted.kind !== 'accepted')
    throw new Error(`Read authority grant refused: ${JSON.stringify(granted)}`);
  assert({
    given:
      'a genuine scoped Staff grant, without any Room seat, host identity or funding change',
    should:
      'let the now-current official reconnect to the same ordinary Round endpoint',
    actual: [
      (await read(stranger, roundId)).id,
      (await read(stranger, roundId)).viewerWatchesAs,
    ],
    expected: [roundId, 'host'],
  });
  // The same official, also named as a youth debater's linked adult.
  const namesOfficial = { linkedAdultActorIds: [stranger.actorId] };
  const linkedToo = Object.assign(async () => namesOfficial, {
    peek: () => namesOfficial,
  });
  assert({
    given:
      'that official also named among the Round’s linked adults (ADR 0155)',
    should:
      'stay a host: event authority grants the capability without the links',
    actual: (await roundViewReader(f.store, linkedToo)(stranger, roundId))
      .viewerWatchesAs,
    expected: 'host',
  });
  const [grant] =
    await owner`select id from grants where lobby_id=${lobbyId} and user_id=${stranger.userId} and revoked_at is null`;
  const removed = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: await expected(),
    command: { type: 'remove-grant', scope, grantId: String(grant!.id) },
  });
  if (removed.kind !== 'accepted')
    throw new Error(
      `Read authority revocation refused: ${JSON.stringify(removed)}`,
    );
  assert({
    given: 'the actual same read after guarded grant revocation',
    should:
      'deny reconnect immediately and preserve current owner access without rewriting the Round',
    actual: [
      await denied(() => read(stranger, roundId)),
      (await read(director, roundId)).id,
      Number(
        (
          await owner`select count(*)::int n from fixture_room_sources where room_id=${world.roomId}`
        )[0]!.n,
      ),
    ],
    expected: [true, roundId, 1],
  });
  const [deadline] =
    await owner`select clock_timestamp()+interval '1 second' expires_at`;
  const expiresAt = new Date(deadline!.expires_at).toISOString();
  const finiteGrant = await send(as(director), {
    version: 1,
    commandId: createId(),
    expected: await expected(),
    command: {
      type: 'give-grant',
      scope,
      userId: stranger.userId,
      roleId: presetStaffRoleId,
      expiresAt,
    },
  });
  if (finiteGrant.kind !== 'accepted')
    throw new Error('Finite read grant refused');
  const { reading } = await owner.begin(async (tx) => {
    await tx`select id from rounds where id=${roundId} for update`;
    const [backend] = await tx`select pg_backend_pid() pid`;
    const reading = denied(() => read(stranger, roundId)).then(
      (ok) => ({ kind: 'answer' as const, ok }),
      (error) => ({ kind: 'failed' as const, error }),
    );
    const blocked = await finishedOrBlockedBehind(
      reading,
      f.sql,
      Number(backend!.pid),
      { waits: hostWaits },
    );
    const [valid] =
      await f.sql`select clock_timestamp()<${expiresAt}::timestamptz valid`;
    assert({
      given:
        'a genuine finite Staff grant and a protected read waiting on the ordinary Round row',
      should: 'reach the actual lock wait while authority is still valid',
      actual: [blocked, valid!.valid],
      expected: ['blocked', true],
    });
    await tx`select pg_sleep(greatest(0,extract(epoch from (${expiresAt}::timestamptz-clock_timestamp())))+0.02)`;
    return { reading };
  });
  const outcome = await reading;
  if (outcome.kind === 'failed') throw outcome.error;
  assert({
    given: 'the grant expiring during the actual Round lock wait',
    should:
      'resample database time after the wait and refuse the stale authority',
    actual: outcome.ok,
    expected: true,
  });
};
