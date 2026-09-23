import { Database } from '@adobe/data/ecs';
import { createAppError, createInvariantError } from '@daisy/errors';
import {
  debateSides,
  formatRulesSchema,
  type DebateSnapshot,
  type Participant,
  type DebatePhase,
} from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';

/**
 * UTF-16 code-unit order: the same on every host, unlike `localeCompare`,
 * whose collation depends on the runtime's ICU data and locale.
 */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const debatePlugin = Database.Plugin.create({
  components: {
    participantId: { type: 'string' },
    side: { enum: debateSides },
    ready: { type: 'boolean', default: false },
  },
  resources: {
    phase: { default: 'waiting' as DebatePhase },
  },
  archetypes: { participant: ['participantId', 'side', 'ready'] },
  transactions: {
    join: (store, participant: Participant) => {
      store.archetypes.participant.insert({
        participantId: participant.id,
        side: participant.side,
        ready: participant.ready,
      });
    },
    ready: (store, participantId: string) => {
      const entity = store
        .select(['participantId'])
        .find((id) => store.get(id, 'participantId') === participantId);
      if (entity === undefined)
        throw createInvariantError(
          debateInvariantIds.readinessRequiresJoin,
          'Participant must join first',
        );
      store.update(entity, { ready: true });
    },
    transition: (store, phase: DebatePhase) => {
      store.resources.phase = phase;
    },
  },
});
/** Adobe storage, IDs and transactions never leave this adapter. */
export function createAdapter(snapshot: DebateSnapshot) {
  const db = Database.create(debatePlugin);
  db.transactions.transition(snapshot.phase);
  for (const participant of snapshot.participants)
    db.transactions.join(participant);
  let disposed = false;
  const assertOpen = () => {
    // Use after dispose is a caller bug, not a domain rule a user can break.
    if (disposed) throw createAppError('INTERNAL', 'Runtime is disposed');
  };
  return {
    snapshot(): DebateSnapshot {
      assertOpen();
      return {
        ...snapshot,
        // A copy: callers preparing lobby overrides edit the returned rules,
        // and the runtime must keep the rules it validated. Parsing builds a
        // fresh object at every level, with no host clone API.
        rules: formatRulesSchema.parse(snapshot.rules),
        phase: db.resources.phase,
        participants: db
          .select(['participantId', 'side', 'ready'])
          .map((entity) => {
            const id = db.get(entity, 'participantId');
            const side = db.get(entity, 'side');
            const ready = db.get(entity, 'ready');
            if (id === undefined || side === undefined || ready === undefined)
              throw createAppError(
                'INTERNAL',
                'ECS participant storage is incomplete',
              );
            return { id, side, ready };
          })
          .sort((a, b) => byCodeUnit(a.id, b.id)),
      };
    },
    join(participant: Participant) {
      assertOpen();
      db.transactions.join(participant);
    },
    markReady(participantId: string) {
      assertOpen();
      db.transactions.ready(participantId);
    },
    transition(phase: DebatePhase) {
      assertOpen();
      db.transactions.transition(phase);
    },
    dispose() {
      if (!disposed) {
        db.reset();
        disposed = true;
      }
    },
  };
}
