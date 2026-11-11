import { z } from 'zod';
import {
  idSchema,
  roomCommandSchema,
  roomRefusalSchema,
  roomViewSchema,
  type RoomView,
  type RoomRefusal,
} from '@daisy/protocol';

import { captureFromFields } from './capture-form';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Submitted =
  | { readonly kind: 'accepted'; readonly view: RoomView }
  | { readonly kind: 'refused'; readonly reason: RoomRefusal | null }
  | { readonly kind: 'invalid' | 'unavailable' };

function commandFields(form: FormData): Record<string, unknown> | null {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form) {
    if (key.startsWith('$ACTION_')) continue;
    if (form.getAll(key).length !== 1) return null;
    raw[key] = value;
  }
  for (const key of [
    'expectedVersion',
    'expectedConsentVersion',
    'slot',
    'ordinal',
    'position',
  ])
    if (key in raw) raw[key] = Number(raw[key]);
  for (const key of ['config', 'definition']) {
    if (!(key in raw)) continue;
    if (typeof raw[key] !== 'string') return null;
    raw[key] = JSON.parse(raw[key]);
  }
  if (raw.type === 'set-capture') return withCapture(raw);
  return 'format' in raw ? withFormatTuple(raw) : raw;
}

/** The plain capture fields become the command's one closed value. */
function withCapture(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const capture = captureFromFields(raw);
  return (
    capture && {
      type: raw.type,
      commandId: raw.commandId,
      expectedVersion: raw.expectedVersion,
      capture,
    }
  );
}

/**
 * One radio or select names a whole catalog tuple (FMT-3); spread it, refuse
 * anything else. A draw room's optional resolution field sends no topic
 * when left empty (FMT-2b).
 */
function withFormatTuple(
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  if (typeof raw.format !== 'string') return null;
  const tuple = formatTupleSchema.safeParse(JSON.parse(raw.format));
  if (!tuple.success) return null;
  const fields = Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => key !== 'format' && !(key === 'topic' && value === ''),
    ),
  );
  return { ...fields, ...tuple.data };
}

const formatTupleSchema = z.strictObject({
  formatId: z.string().min(1),
  formatVersion: z.int().positive(),
  presetVersion: z.int().positive(),
});

const responseSchema = z.object({ view: roomViewSchema });
const refusalSchema = z.object({ refusal: roomRefusalSchema });

/** The Room refusal a reply's body names; null when it cannot be read or names none. */
async function namedRefusal(response: Response): Promise<RoomRefusal | null> {
  const body = refusalSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.refusal : null;
}

export async function submitAssembly(
  fetch: FetchLike,
  roomId: string,
  form: FormData,
): Promise<Submitted> {
  if (!idSchema.safeParse(roomId).success) return { kind: 'invalid' };
  let fields;
  try {
    fields = commandFields(form);
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = roomCommandSchema.safeParse(fields);
  if (!parsed.success) return { kind: 'invalid' };
  try {
    const response = await fetch(`/api/rooms/${roomId}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    });
    if (!response.ok) {
      const reason = await namedRefusal(response);
      // A refusal the Room names recorded nothing, whatever status carries
      // it (readiness that cannot be read is a 503). A server fault that
      // names none may have recorded the command.
      return reason === null && response.status >= 500
        ? { kind: 'unavailable' }
        : { kind: 'refused', reason };
    }
    const body = responseSchema.safeParse(await response.json());
    return body.success && body.data.view.id === roomId
      ? { kind: 'accepted', view: body.data.view }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
