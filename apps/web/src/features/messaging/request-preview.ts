import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { createMessagingSocialSchemas } from '@daisy/protocol';
/** A refused protected preview is never interpreted as a request or an empty introduction. */
export async function readRequestPreviewResponse(response: Response) {
  if (!response.ok) return null;
  const positive = z.coerce.number().int().positive().safe();
  const bounds = z
    .strictObject({
      introductionUnits: positive,
      titleUnits: positive,
      batchActors: positive,
    })
    .safeParse({
      introductionUnits: response.headers.get('x-messaging-introduction-units'),
      titleUnits: response.headers.get('x-messaging-title-units'),
      batchActors: response.headers.get('x-messaging-batch-actors'),
    });
  if (!bounds.success) throw createAppError('INFRASTRUCTURE');
  const preview = createMessagingSocialSchemas(
    bounds.data,
  ).previewDmResult.safeParse(await response.json());
  if (!preview.success) throw createAppError('INFRASTRUCTURE');
  return preview.data;
}
