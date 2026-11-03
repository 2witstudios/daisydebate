import { AsyncLocalStorage } from 'node:async_hooks';
import { floorClockOf, floorDueAt } from './floor-clock';
import type { MediaOperationInput } from './operation-context';

/** Whose call ran a pass. */
type FloorMover = 'tick' | 'browser' | 'capture';
type OpenPass = {
  readonly roundId: string;
  readonly roomName: string;
  readonly mover: FloorMover;
  readonly startedAtMs: number;
  vendorCalls: number;
  vendorMs: number;
  permissionWrites: number;
  /** The grants this pass last read from LiveKit, by identity. */
  readonly seen: Map<string, readonly string[]>;
  /** The committed floor change the last authorized write acts on. */
  dueAtMs: number | null;
  move: { readonly dueAtMs: number; readonly appliedAtMs: number } | null;
};
type Begin = MediaOperationInput['store']['beginMediaMutation'];
const MICROPHONE = 'microphone';

/** Whether LiveKit's answer changes who may use the microphone. */
const movesFloor = (
  before: readonly string[] | undefined,
  after: readonly string[],
) => before?.includes(MICROPHONE) !== after.includes(MICROPHONE);

/**
 * Server events for floor control (FLOOR-2), around the pass rather than in it:
 * it decorates the store and the vendor a pass already calls, so the reconcile
 * rules hold no measurement and cannot be changed by it. Opaque Round ids only.
 */
export function observeFloor(input: MediaOperationInput) {
  const movers = new AsyncLocalStorage<FloorMover>();
  /** Open passes by lease owner, which each fence names. */
  const passes = new Map<string, OpenPass>();
  let outsidePasses = 0;
  const onRoom = (room: string) =>
    [...passes.values()].find((pass) => pass.roomName === room);
  const timed = async <T>(room: string, call: () => Promise<T>) => {
    const pass = onRoom(room);
    const startedAtMs = input.now();
    if (!pass) outsidePasses += 1;
    try {
      return await call();
    } finally {
      if (pass) {
        pass.vendorCalls += 1;
        pass.vendorMs += input.now() - startedAtMs;
      }
    }
  };
  const close = (owner: string) => {
    const pass = passes.get(owner);
    if (!pass) return;
    passes.delete(owner);
    const { roundId, mover, move } = pass;
    if (move)
      input.logger.log(
        'round.media.floor_moved',
        { roundId, mover, ...move },
        'A pass moved the floor at LiveKit',
      );
    input.logger.log(
      'round.media.pass',
      {
        roundId,
        mover,
        durationMs: input.now() - pass.startedAtMs,
        vendorCalls: pass.vendorCalls,
        vendorMs: pass.vendorMs,
        permissionWrites: pass.permissionWrites,
        vendorCallsOutsidePasses: outsidePasses,
      },
      'A reconcile pass finished',
    );
    outsidePasses = 0;
  };
  const beginMediaMutation: Begin = (begin) =>
    input.store.beginMediaMutation({
      ...begin,
      authorize: (context) => {
        const pass = passes.get(begin.owner);
        if (pass)
          pass.dueAtMs = floorDueAt(
            floorClockOf(context.round),
            Date.parse(context.now),
          );
        return begin.authorize(context);
      },
    });
  const observed: MediaOperationInput = {
    ...input,
    store: {
      ...input.store,
      beginMediaMutation,
      claimMediaReconcile: async (request) => {
        const claim = await input.store.claimMediaReconcile(request);
        if (claim.kind === 'claimed')
          passes.set(claim.fence.owner, {
            roundId: claim.roundId,
            roomName: claim.roomName,
            mover: movers.getStore() ?? 'browser',
            startedAtMs: input.now(),
            vendorCalls: 0,
            vendorMs: 0,
            permissionWrites: 0,
            seen: new Map(),
            dueAtMs: null,
            move: null,
          });
        return claim;
      },
      finishMediaReconcile: async (finish) => {
        try {
          return await input.store.finishMediaReconcile(finish);
        } finally {
          close(finish.owner);
        }
      },
    },
    media: {
      ...input.media,
      exists: (room) => timed(room, () => input.media.exists(room)),
      roomSid: (room) => timed(room, () => input.media.roomSid(room)),
      createRoom: (room) => timed(room, () => input.media.createRoom(room)),
      deleteRoom: (room) => timed(room, () => input.media.deleteRoom(room)),
      publicationPermissions: (room) =>
        timed(room, async () => {
          const current = await input.media.publicationPermissions(room);
          const pass = onRoom(room);
          for (const { identity, grants } of current)
            pass?.seen.set(identity, grants.publish);
          return current;
        }),
      permissions: (room, identity, grants) =>
        timed(room, async () => {
          await input.media.permissions(room, identity, grants);
          const pass = onRoom(room);
          if (!pass) return;
          pass.permissionWrites += 1;
          const publish = grants.publish ?? [];
          if (
            pass.dueAtMs !== null &&
            movesFloor(pass.seen.get(identity), publish)
          )
            pass.move = { dueAtMs: pass.dueAtMs, appliedAtMs: input.now() };
          pass.seen.set(identity, publish);
        }),
    },
  };
  return {
    input: observed,
    /** Runs `work` so a pass it starts names `mover`; unnamed work is a browser's. */
    asMover: <T>(mover: FloorMover, work: () => T): T =>
      movers.run(mover, work),
  };
}
