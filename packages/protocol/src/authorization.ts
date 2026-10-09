import { z } from 'zod';
/** Closed launch vocabulary: league grants belong to LEAGUE-OPS. */
const authorizationCapabilities = [
  'social.block',
  'social.request.create',
  'channel.create.private_group',
  'foundation.create',
  'foundation.read',
  'round.read',
  'room.create',
  'room.list',
  'room.read',
  'room.join',
  'room.manage',
  'room.ready',
  'room.leave',
  'channel.read',
  'channel.post',
  'channel.message.remove',
  'channel.file.cleanup',
  'channel.manage',
  'channel.subscribe',
  'channel.request.read',
  'channel.request.decide',
  'channel.request.cancel',
] as const;
export const authorizationCapabilitySchema = z.enum(authorizationCapabilities);
export type AuthorizationCapability = z.infer<
  typeof authorizationCapabilitySchema
>;
/** Internal decision reason vocabulary; no serialized deny-reason reader exists. */
export type AuthorizationDenyReason =
  'denied' | 'account-erased' | 'unauthenticated' | 'missing-capability';
