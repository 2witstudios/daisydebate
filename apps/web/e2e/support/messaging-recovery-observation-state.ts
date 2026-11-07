import type { clientMessageSchema, ServerMessage } from '@daisy/protocol';
type ClientMessage = ReturnType<typeof clientMessageSchema.parse>;
import { channelMessages } from '../../src/features/messaging/channel-messages';

type Observation =
  | { readonly kind: 'idle' | 'closed' }
  | {
      readonly kind: 'pending';
      readonly id: string;
      readonly generation: number;
    }
  | {
      readonly kind: 'ready';
      readonly id: string;
      readonly generation: number;
      readonly partition: string;
      readonly disclosureRevision: number;
      readonly minimumRevision: number;
      readonly deadline: number;
      readonly revision: number | null;
    };
type Event =
  | { readonly kind: 'closed' }
  | { readonly kind: 'sent'; readonly frame: ClientMessage }
  | { readonly kind: 'received'; readonly frame: ServerMessage };

export const initialRecoveryObservation = (): Observation => ({ kind: 'idle' });
export const recoveryObservationView = (state: Observation, now: number) =>
  state.kind === 'ready' && state.deadline > now
    ? { ready: true, revision: state.revision }
    : { ready: false, revision: null };

/** This oracle's one socket, request and current permit base; no lifetime watermark. */
export function recoveryObservation(
  state: Observation,
  event: Event,
  channelId: string,
  now: number,
): Observation {
  if (state.kind === 'closed') return state;
  if (event.kind === 'closed') return { kind: 'closed' };
  const { frame } = event;
  if (
    !('resource' in frame) ||
    frame.resource.kind !== 'channel-messages' ||
    frame.resource.id !== channelId
  )
    return state;
  if (event.kind === 'sent') {
    if (event.frame.type === 'unobserve') return { kind: 'idle' };
    return event.frame.type === 'observe'
      ? { kind: 'pending', id: event.frame.id, generation: -1 }
      : state;
  }
  if (state.kind !== 'pending' && state.kind !== 'ready') return state;
  if (frame.type === 'observation.snapshot') {
    if (
      state.kind !== 'ready' ||
      state.deadline <= now ||
      frame.partition !== state.partition ||
      frame.disclosureRevision !== state.disclosureRevision ||
      frame.contentRevision < state.minimumRevision
    )
      return state;
    const body = channelMessages(channelId).parse(frame.body);
    return body !== null &&
      body.changeVersion === frame.contentRevision &&
      (state.revision === null || frame.contentRevision >= state.revision)
      ? { ...state, revision: frame.contentRevision }
      : state;
  }
  if (frame.type !== 'observation.ready' && frame.type !== 'observation.state')
    return state;
  if (
    (frame.id !== undefined && frame.id !== state.id) ||
    frame.generation < state.generation
  )
    return state;
  if (frame.type === 'observation.state')
    return frame.state === 'denied' || frame.state === 'revoked'
      ? { kind: 'idle' }
      : { kind: 'pending', id: state.id, generation: frame.generation };
  const retained =
    state.kind === 'ready' &&
    state.deadline > now &&
    state.generation === frame.generation &&
    state.partition === frame.partition &&
    state.disclosureRevision === frame.disclosureRevision &&
    state.revision !== null &&
    state.revision >= frame.minimumContentRevision;
  return {
    kind: 'ready',
    id: frame.id,
    generation: frame.generation,
    partition: frame.partition,
    disclosureRevision: frame.disclosureRevision,
    minimumRevision: frame.minimumContentRevision,
    deadline: now + frame.validForMs,
    revision: retained ? state.revision : null,
  };
}
