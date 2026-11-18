import { z } from 'zod';
import type { AuthorizationCapability } from './authorization';
import { idSchema } from './primitives';

/**
 * `standings:<season>` names a season slug, not an entity id, so it is not
 * cuid2: lowercase, digits and hyphens, but a trailing hyphen is never
 * valid — the slug must start and end on an alphanumeric.
 */
const seasonIdSchema = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);

/**
 * The one topic-family vocabulary: the families realtime delivers on.
 * A family is a topic's first segment, plus its third when it has one
 * (`round:<id>:presence` is `round:presence`). Every other string is
 * refused by `parseTopic` at the trust boundary. The outbox storage rule
 * (realtime-payloads.ts) is keyed by it.
 */
const topicFamilies = [
  'room',
  'round',
  'round:presence',
  'user:inbox',
  'standings',
  'channel',
  'online',
  'lobby',
  'lobby:host',
  'organization:host',
] as const;
const topicFamilySchema = z.enum(topicFamilies);
export type TopicFamily = z.infer<typeof topicFamilySchema>;

type ParsedTopic =
  | {
      readonly family: Exclude<
        TopicFamily,
        | 'user:inbox'
        | 'standings'
        | 'channel'
        | 'room'
        | 'online'
        | 'lobby'
        | 'lobby:host'
        | 'organization:host'
      >;
      readonly roundId: string;
    }
  | { readonly family: 'online' }
  | { readonly family: 'room'; readonly roomId: string }
  | { readonly family: 'user:inbox'; readonly actorId: string }
  | { readonly family: 'channel'; readonly channelId: string }
  | { readonly family: 'standings'; readonly season: string }
  | { readonly family: 'lobby' | 'lobby:host'; readonly lobbyId: string }
  | { readonly family: 'organization:host'; readonly organizationId: string };

/** `<head>:<key>` or `<head>:<key>:<suffix>` names the family `<head>[:<suffix>]`. */
function familyOf(segments: readonly string[]): string | undefined {
  if (segments.length === 2) return segments[0];
  if (segments.length === 3) return `${segments[0]}:${segments[2]}`;
  return undefined;
}

/**
 * Parses a topic string into its family and ids, validating every id
 * segment against cuid2 (and `standings`'s season slug). Returns `undefined`
 * for anything that is not one of the known shapes exactly, including
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
  if (family.data === 'online')
    return key === 'members' ? { family: 'online' } : undefined;
  if (family.data === 'standings')
    return seasonIdSchema.safeParse(key).success
      ? { family: 'standings', season: key }
      : undefined;
  if (!idSchema.safeParse(key).success) return undefined;
  return keyed(family.data, key);
}

/** The families keyed by one cuid2 id, from that id. */
function keyed(
  family: Exclude<TopicFamily, 'online' | 'standings'>,
  key: string,
): ParsedTopic {
  switch (family) {
    case 'channel':
      return { family, channelId: key };
    case 'room':
      return { family, roomId: key };
    case 'lobby':
    case 'lobby:host':
      return { family, lobbyId: key };
    case 'organization:host':
      return { family, organizationId: key };
    case 'user:inbox':
      return { family, actorId: key };
    case 'round':
    case 'round:presence':
      return { family, roundId: key };
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
  // A parse-cost guard, not a grammar limit: no valid topic comes near 128,
  // so there is no accept edge to test. It aborts, so an oversized string
  // never reaches parseTopic's grammar.
  .max(128, { abort: true })
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

/**
 * The people list's doorbell (ADR 0103): one shared topic for every member.
 * Its frame names nobody, and the list itself is an authorized read.
 */
export const ONLINE_TOPIC = 'online:members';

/** A Round's public doorbell topic (phase and transcript changes). */
export const buildRoundTopic = (roundId: string): string =>
  `round:${idSchema.parse(roundId)}`;

/** Persistent messaging authorization boundary (ADR 0060). */
export const buildChannelTopic = (channelId: string): string =>
  `channel:${idSchema.parse(channelId)}`;
export const buildRoomTopic = (roomId: string): string =>
  `room:${idSchema.parse(roomId)}`;

/**
 * A lobby's doorbell: its listing, and for a tournament its posting, an
 * audience opening, an announcement, standings or resolved settings changed.
 */
export const buildLobbyTopic = (lobbyId: string): string =>
  `lobby:${idSchema.parse(lobbyId)}`;
/** What a lobby's officials watch: entries, drafts, fixtures, slots, holds. */
export const buildLobbyHostTopic = (lobbyId: string): string =>
  `lobby:${idSchema.parse(lobbyId)}:host`;
/** An organization's people, grants, templates, settings and sanctions. */
export const buildOrganizationHostTopic = (organizationId: string): string =>
  `organization:${idSchema.parse(organizationId)}:host`;

/**
 * The one capability a lobby or organization topic is subscribed under: a
 * viewer may subscribe exactly when they may make the matching read
 * (TAB-5.15).
 */
export const lobbyTopicCapability = {
  lobby: 'lobby.read',
  'lobby:host': 'lobby.host.read',
  'organization:host': 'organization.host.read',
} as const satisfies Partial<Record<TopicFamily, AuthorizationCapability>>;
