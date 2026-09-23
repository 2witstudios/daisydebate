import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * `standings:<season>` names a season slug, not an entity id, so it is not
 * cuid2. Same shape as `formatIdSchema` in ./index (lowercase, digits and
 * hyphens), but a trailing hyphen is never valid: the slug must start and
 * end on an alphanumeric.
 */
export const seasonIdSchema = z
  .string()
  .regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);

/**
 * The five topic families this epic delivers on. Every other string is
 * refused: by `parseTopic` at the trust boundary, and by
 * `subscribeAuthorizationTable` for anything not listed there.
 *
 * Lives in its own module (not realtime.ts or realtime-payloads.ts) because
 * both of those need it and neither may import the other without a cycle:
 * realtime.ts's `event` message validates against `realtime-payloads.ts`'s
 * outbox schema, and that validation is keyed by topic family.
 */
export type TopicFamily =
  'debate' | 'debate:presence' | 'debate:chat' | 'user:inbox' | 'standings';

export type ParsedTopic =
  | { readonly family: 'debate'; readonly debateId: string }
  | { readonly family: 'debate:presence'; readonly debateId: string }
  | { readonly family: 'debate:chat'; readonly debateId: string }
  | { readonly family: 'user:inbox'; readonly actorId: string }
  | { readonly family: 'standings'; readonly season: string };

function parseDebateTopic(segments: string[]): ParsedTopic | undefined {
  if (segments.length < 2 || segments.length > 3) return undefined;
  const debateId = segments[1]!;
  if (!idSchema.safeParse(debateId).success) return undefined;
  if (segments.length === 2) return { family: 'debate', debateId };
  const suffix = segments[2]!;
  if (suffix === 'presence') return { family: 'debate:presence', debateId };
  if (suffix === 'chat') return { family: 'debate:chat', debateId };
  return undefined;
}

/**
 * The owner segment is the ticket's `actorId`, not a `users.id` (actors and
 * users are distinct ids, ADR 0031 §5): `user:inbox` subscribe
 * authorization matches this segment against the connecting ticket's
 * actorId (`subscribeAuthorizationTable` in ./realtime), never the caller's
 * `users` row.
 */
function parseUserTopic(segments: string[]): ParsedTopic | undefined {
  if (segments.length !== 3 || segments[2] !== 'inbox') return undefined;
  const actorId = segments[1]!;
  return idSchema.safeParse(actorId).success
    ? { family: 'user:inbox', actorId }
    : undefined;
}

function parseStandingsTopic(segments: string[]): ParsedTopic | undefined {
  if (segments.length !== 2) return undefined;
  const season = segments[1]!;
  return seasonIdSchema.safeParse(season).success
    ? { family: 'standings', season }
    : undefined;
}

/**
 * Parses a topic string into its family and ids, validating every id
 * segment against cuid2 (and `standings`'s season slug). Returns `undefined`
 * for anything that is not one of the five known shapes exactly, including
 * extra segments or a missing/malformed id — parsing never normalizes or
 * repairs input (ADR 0023).
 */
export function parseTopic(topic: string): ParsedTopic | undefined {
  const segments = topic.split(':');
  switch (segments[0]) {
    case 'debate':
      return parseDebateTopic(segments);
    case 'user':
      return parseUserTopic(segments);
    case 'standings':
      return parseStandingsTopic(segments);
    default:
      return undefined;
  }
}

/**
 * A topic string, validated through the shared parser, for message schemas.
 * Bounded well above the longest real topic (`standings:<64-char slug>` is
 * 74 characters) but far under the frame cap (ADR 0031 §6's
 * `maxPayloadLength: 4096`), so an oversized topic is rejected here rather
 * than by the transport.
 */
export const topicStringSchema = z
  .string()
  // Aborts: an oversized string never reaches parseTopic's grammar.
  .max(128, { abort: true })
  .refine((value) => parseTopic(value) !== undefined, {
    message: 'Not a valid realtime topic',
  });

/**
 * The only way topic strings are built. Every consumer in `apps/web` and
 * `apps/realtime` must call these instead of building the string by hand;
 * the drift-guard test enforces it. Each builder validates its id segment
 * and throws on a malformed one, so a bad topic is never constructed.
 */
export const buildDebateTopic = (debateId: string): string =>
  `debate:${idSchema.parse(debateId)}`;
export const buildDebatePresenceTopic = (debateId: string): string =>
  `debate:${idSchema.parse(debateId)}:presence`;
export const buildDebateChatTopic = (debateId: string): string =>
  `debate:${idSchema.parse(debateId)}:chat`;
export const buildUserInboxTopic = (actorId: string): string =>
  `user:${idSchema.parse(actorId)}:inbox`;
export const buildStandingsTopic = (season: string): string =>
  `standings:${seasonIdSchema.parse(season)}`;
