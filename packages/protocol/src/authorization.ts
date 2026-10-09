import { z } from 'zod';
/** Closed launch vocabulary: league grants belong to LEAGUE-OPS. */
const authorizationCapabilities = [
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
const authorizationDenyReasons = [
  'denied',
  'account-erased',
  'unauthenticated',
  'missing-capability',
] as const;
const authorizationDenyReasonSchema = z.enum(authorizationDenyReasons);

export type AuthorizationDenyReason = z.infer<
  typeof authorizationDenyReasonSchema
>;
