import { createAppError } from '@daisy/errors';
import { parseMessagingFileForm } from '../forms/file-form';
import { messagingFileResponseSchemas } from './response';
/** Native form transport invokes mounted operations; it never supplies storage authority. */
export async function attachMessagingFormFile(
  channelId: unknown,
  messageId: unknown,
  form: FormData,
  transport: {
    reserved: (token: { fileId: string; generation: number }) => void;
    reserve: (command: unknown) => Promise<Response>;
    upload: (
      channelId: string,
      fileId: string,
      generation: number,
      bytes: Uint8Array<ArrayBuffer>,
    ) => Promise<Response>;
    finalize: (command: unknown) => Promise<Response>;
  },
) {
  const intent = parseMessagingFileForm(channelId, messageId, form);
  const reserved = await transport.reserve({
    version: 1,
    channelId: intent.channelId,
    requestId: intent.requestId,
    filename: intent.file.name,
    mime: intent.file.type,
    bytes: intent.file.size,
  });
  if (!reserved.ok) throw createAppError('VALIDATION');
  const schemas = messagingFileResponseSchemas(reserved);
  const reservation = schemas.reservationResult.safeParse(
    await reserved.json(),
  );
  if (!reservation.success) throw createAppError('INFRASTRUCTURE');
  requireReservationIntent(reservation.data, intent.file);
  transport.reserved({
    fileId: reservation.data.fileId,
    generation: reservation.data.generation,
  });
  const uploaded = await transport.upload(
    intent.channelId,
    reservation.data.fileId,
    reservation.data.generation,
    new Uint8Array(await intent.file.arrayBuffer()),
  );
  if (!uploaded.ok) throw createAppError('VALIDATION');
  const token = schemas.tokenResult.safeParse(await uploaded.json());
  if (
    !token.success ||
    token.data.fileId !== reservation.data.fileId ||
    token.data.generation !== reservation.data.generation
  )
    throw createAppError('INFRASTRUCTURE');
  const finalized = await transport.finalize({
    ...token.data,
    channelId: intent.channelId,
    messageId: intent.messageId,
  });
  if (!finalized.ok) throw createAppError('VALIDATION');
  const result = schemas.tokenResult.safeParse(await finalized.json());
  if (!result.success || !sameToken(result.data, token.data))
    throw createAppError('INFRASTRUCTURE');
  return result.data;
}

function sameToken(
  a: { fileId: string; generation: number },
  b: { fileId: string; generation: number },
) {
  return a.fileId === b.fileId && a.generation === b.generation;
}

function requireReservationIntent(
  reservation: { filename: string; mime: string; bytes: number },
  file: File,
) {
  if (
    reservation.filename !== file.name ||
    reservation.mime !== file.type ||
    reservation.bytes !== file.size
  )
    throw createAppError('INFRASTRUCTURE');
}
