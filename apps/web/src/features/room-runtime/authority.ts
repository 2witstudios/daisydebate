import {
  authorize,
  type AccountAuthorizationFact,
  type AuthorizationCapability,
  type RoomAuthorizationFact,
} from '@daisy/auth/authorization';
import type { RoomCommand, RoomAssemblyState } from '@daisy/protocol';
import type { Caller } from './operations';
type RoomFactSource = Pick<
  RoomAssemblyState,
  'id' | 'hostActorId' | 'visibility' | 'status' | 'version'
> & { readonly participants: RoomAuthorizationFact['participants'] };
const roomFact = (state: RoomFactSource): RoomAuthorizationFact => ({
  kind: 'room' as const,
  roomId: state.id,
  hostActorId: state.hostActorId,
  visibility: state.visibility,
  status: state.status,
  revision: state.version,
  participants: state.participants,
});
export const can = (
  caller: Caller,
  capability: AuthorizationCapability,
  account: AccountAuthorizationFact | null,
  state?: RoomFactSource,
) =>
  authorize({
    principal: { kind: 'user', ...caller },
    capability,
    context: { account },
    resource: state ? roomFact(state) : { kind: 'room_collection' },
  }).allow;
export const capabilityOf = (command: RoomCommand): AuthorizationCapability =>
  command.type === 'claim-seat'
    ? 'room.join'
    : command.type === 'ready' || command.type === 'unready'
      ? 'room.ready'
      : command.type === 'leave-seat'
        ? 'room.leave'
        : 'room.manage';
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
export const digest = (value: unknown) =>
  new Bun.CryptoHasher('sha3-256').update(canonical(value)).digest('hex');
