import { Database } from '@adobe/data/ecs';
import { createAppError } from '@daisy/errors';
import type { DebateSnapshot, Participant, DebatePhase } from '@daisy/protocol';
const debatePlugin = Database.Plugin.create({
  components: {
    participantId: { type: 'string' },
    side: { enum: ['affirmative', 'negative'] },
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
        throw createAppError('INVARIANT', 'Participant must join first');
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
    if (disposed) throw createAppError('INVARIANT', 'Runtime is disposed');
  };
  return {
    snapshot(): DebateSnapshot {
      assertOpen();
      return {
        ...snapshot,
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
          .sort((a, b) => a.id.localeCompare(b.id)),
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
