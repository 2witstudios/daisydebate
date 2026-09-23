import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * `standings:<season>` names a season slug, not an entity id, so it is not
 * cuid2. Same shape as `formatIdSchema` in ./index (lowercase, digits and
 * hyphens), but a trailing hyphen is never valid: the slug must start and
 * end on an alphanumeric.
 */
const seasonIdSchema = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);

/**
 * The one topic-family vocabulary: the five families realtime delivers on.
 * A family is a topic's first segment, plus its third when it has one
 * (`debate:<id>:presence` is `debate:presence`). Every other string is
 * refused by `parseTopic` at the trust boundary. The outbox storage rule
 * (realtime-payloads.ts) is keyed by it.
 */
const topicFamilies = [
  'debate',
  'debate:presence',
  'debate:chat',
  'user:inbox',
  'standings',
] as const;
const topicFamilySchema = z.enum(topicFamilies);
export type TopicFamily = z.infer<typeof topicFamilySchema>;

type ParsedTopic =
  | {
      readonly family: Exclude<TopicFamily, 'user:inbox' | 'standings'>;
      readonly debateId: string;
    }
  | { readonly family: 'user:inbox'; readonly actorId: string }
  | { readonly family: 'standings'; readonly season: string };

/** `<head>:<key>` or `<head>:<key>:<suffix>` names the family `<head>[:<suffix>]`. */
function familyOf(segments: readonly string[]): string | undefined {
  if (segments.length === 2) return segments[0];
  if (segments.length === 3) return `${segments[0]}:${segments[2]}`;
  return undefined;
}

/**
 * Parses a topic string into its family and ids, validating every id
 * segment against cuid2 (and `standings`'s season slug). Returns `undefined`
 * for anything that is not one of the five known shapes exactly, including
 * extra segments or a missing/malformed id — parsing never normalizes or
 * repairs input (ADR 0023).
 *
 * The `user:inbox` key is the ticket's `actorId`, not a `users.id` (actors
 * and users are distinct ids, ADR 0031 §5): subscribe authorization matches
 * it against the connecting ticket's actorId, never the caller's `users` row.
 */
export function parseTopic(topic: string): ParsedTopic | undefined {
  const segments = topic.split(':');
  const family = topicFamilySchema.safeParse(familyOf(segments));
  if (!family.success) return undefined;
  const key = segments[1]!;
  if (family.data === 'standings')
    return seasonIdSchema.safeParse(key).success
      ? { family: 'standings', season: key }
      : undefined;
  if (!idSchema.safeParse(key).success) return undefined;
  return family.data === 'user:inbox'
    ? { family: 'user:inbox', actorId: key }
    : { family: family.data, debateId: key };
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
  .max(128)
  .refine((value) => parseTopic(value) !== undefined, {
    message: 'Not a valid realtime topic',
  });

/**
 * The only way a topic string is built: the id segment is validated and a
 * malformed one throws, so a bad topic is never constructed. Builders for
 * the other families are added with their first consumer.
 */
export const buildUserInboxTopic = (actorId: string): string =>
  `user:${idSchema.parse(actorId)}:inbox`;
