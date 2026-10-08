import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { MAX_FIELD_LENGTH } from './library/library-query';

const panels = ['speech', 'cards', 'search'] as const;
export type PanelTab = (typeof panels)[number];

/**
 * The prep panel's state. A seat's pinned case is server state in the real
 * product; until then the URL carries it (`pin`, `v`) so each step of the
 * flow is a link that works without a script.
 */
export type RoomPanelQuery = {
  /** A case id, "none" (search only), or empty (nothing chosen yet). */
  readonly pin: string;
  /** The pinned version, or 0 for the newest. */
  readonly version: number;
  readonly tab: PanelTab;
  /** A card open for reading. */
  readonly card: string;
  /** True while "Send to room?" is asking. */
  readonly send: boolean;
  /** True once "Keep v4" dismissed the changed-elsewhere notice. */
  readonly keep: boolean;
  readonly q: string;
  /** Phone: the sheet is open. */
  readonly open: boolean;
  /** Desktop: the panel is hidden. */
  readonly hidden: boolean;
};

const token = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/)
  .catch('');

const schema = z.object({
  pin: token,
  v: z.coerce.number().int().min(1).max(9999).catch(0),
  tab: z.enum(panels).catch('speech'),
  card: token,
  send: z.string().catch(''),
  keep: z.string().catch(''),
  q: z
    .string()
    .transform((v) => v.trim().slice(0, MAX_FIELD_LENGTH))
    .catch(''),
  open: z.string().catch(''),
  hide: z.string().catch(''),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export function parseRoomPanelQuery(params: SearchParams): RoomPanelQuery {
  const p = schema.parse({
    pin: first(params['pin']) ?? '',
    v: first(params['v']) ?? 0,
    tab: first(params['tab']),
    card: first(params['card']) ?? '',
    send: first(params['send']) ?? '',
    keep: first(params['keep']) ?? '',
    q: first(params['q']) ?? '',
    open: first(params['open']) ?? '',
    hide: first(params['hide']) ?? '',
  });
  return {
    pin: p.pin,
    version: p.v,
    tab: p.tab,
    card: p.card,
    send: p.send === '1',
    keep: p.keep === '1',
    q: p.q,
    open: p.open === '1',
    hidden: p.hide === '1',
  };
}

const flags: readonly (readonly [keyof RoomPanelQuery, string])[] = [
  ['send', 'send'],
  ['keep', 'keep'],
  ['open', 'open'],
  ['hidden', 'hide'],
];

/** The in-debate page URL for a state, carrying only what differs from the default. */
export function roomPanelHref(query: Partial<RoomPanelQuery>): string {
  const params = new URLSearchParams();
  if (query.pin) params.set('pin', query.pin);
  if (query.version) params.set('v', String(query.version));
  if (query.tab && query.tab !== 'speech') params.set('tab', query.tab);
  if (query.card) params.set('card', query.card);
  for (const [key, name] of flags)
    if (query[key] === true) params.set(name, '1');
  if (query.q) params.set('q', query.q);
  const text = params.toString();
  return text === '' ? '/prep/in-debate' : `/prep/in-debate?${text}`;
}
