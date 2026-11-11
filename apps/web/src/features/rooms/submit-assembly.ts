import { z } from 'zod';
import {
  idSchema,
  roomCommandSchema,
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
      if (response.status >= 500) return { kind: 'unavailable' };
      // The status already refuses; a body that cannot be read only loses the reason.
      const body = z
        .object({ refusal: roomViewSchema.shape.startRefusal })
        .safeParse(await response.json().catch(() => null));
      return {
        kind: 'refused',
        reason: body.success ? body.data.refusal : null,
      };
    }
    const body = responseSchema.safeParse(await response.json());
    return body.success && body.data.view.id === roomId
      ? { kind: 'accepted', view: body.data.view }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
