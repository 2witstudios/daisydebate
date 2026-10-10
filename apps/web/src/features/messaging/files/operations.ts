import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock, IdGenerator } from '@daisy/clock';
import {
  requireFilePolicy,
  type FilePolicy,
  type FileStore,
  type FileScope,
  type FileToken,
} from '@daisy/db/messaging-files';
import { createMessagingFileSchemas } from '@daisy/protocol';
import { createAppError, isAppError } from '@daisy/errors';
import { requireMessagingActor } from '../principal';
import { parseValidated } from '../../../server/http';
import { requireFileSignature } from './content';
import { requireFileAttempt } from './attempt';
import { sameFileBytes } from './same-bytes';
import type { FileScanner, ImageSanitizer, PrivateObjectStore } from './ports';
export type FileDependencies = {
  readonly policy: FilePolicy | undefined;
  readonly store: FileStore;
  readonly objects: PrivateObjectStore;
  readonly scanner: FileScanner;
  readonly sanitizeImage: ImageSanitizer;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Trusted cleanup fence: pending only, same scope/owner/generation; no protected replay. */
  readonly failPending: (scope: FileScope, token: FileToken) => Promise<void>;
};
async function cleanupPending(
  d: FileDependencies,
  scope: FileScope,
  token: FileToken,
) {
  try {
    await d.failPending(scope, token);
  } catch (error) {
    // A newer generation, attachment or erasure must refuse stale cleanup.
    if (
      isAppError(error) &&
      ['AUTHORIZATION', 'NOT_FOUND'].includes(error.code)
    )
      return;
    throw isAppError(error) ? error : createAppError('INFRASTRUCTURE');
  }
}
function context(principal: AuthorizationPrincipal, d: FileDependencies) {
  return {
    identity: requireMessagingActor(principal),
    policy: requireFilePolicy(d.policy),
  };
}
const publicReservation = (
  reservation: import('@daisy/db/messaging-files').FileReservation,
) => ({
  fileId: reservation.id,
  generation: reservation.generation,
  filename: reservation.filename,
  mime: reservation.mime,
  bytes: reservation.reservedBytes,
  expiresAt: reservation.expiresAt,
});
export async function reserveMessagingFile(
  input: unknown,
  principal: AuthorizationPrincipal,
  d: FileDependencies,
) {
  const { policy, identity } = context(principal, d);
  const command = parseValidated(
    createMessagingFileSchemas(policy).reserve,
    input,
  );
  return d.store.withChannel(
    { ...identity, channelId: command.channelId },
    'post',
    async (frame) => {
      await frame.authorize();
      return publicReservation(
        await frame.reserve(
          { ...command, id: d.ids.next(), objectKey: d.ids.next() },
          d.clock.now(),
          policy,
        ),
      );
    },
  );
}
/** Object write remains inside the account/channel fence; asynchronous scanning does not. */
export async function uploadMessagingFile(
  input: unknown,
  bytes: Uint8Array,
  principal: AuthorizationPrincipal,
  d: FileDependencies,
) {
  const { policy, identity } = context(principal, d);
  const command = parseValidated(
    createMessagingFileSchemas(policy).access,
    input,
  );
  const scope = { ...identity, channelId: command.channelId };
  const token = { fileId: command.fileId, generation: command.generation };
  const startedAt = d.clock.now();
  let cleanup = false;
  try {
    return await d.store.withChannel(scope, 'post', async (frame) => {
      const reservation = await frame.upload(token, d.clock.now());
      cleanup = reservation.lifecycle === 'reserved';
      if (
        bytes.byteLength < 1 ||
        bytes.byteLength > reservation.reservedBytes ||
        bytes.byteLength > policy.maxFileBytes
      )
        throw createAppError('PAYLOAD_TOO_LARGE');
      requireFileSignature(bytes, reservation.mime);
      let stored = bytes;
      if (reservation.mime !== 'application/pdf') {
        if (
          (await d.scanner.scan(bytes, {
            maxBytes: policy.maxFileBytes,
            serviceMs: policy.serviceMs,
          })) !== 'clean'
        )
          throw createAppError('VALIDATION');
        stored = await d.sanitizeImage(bytes, reservation.mime, {
          maxPixels: policy.maxImagePixels,
          maxBytes: policy.maxFileBytes,
          serviceMs: policy.serviceMs,
        });
        requireFileSignature(stored, reservation.mime);
        if (stored.length > reservation.reservedBytes)
          throw createAppError('PAYLOAD_TOO_LARGE');
      }
      if (reservation.lifecycle !== 'reserved') {
        const existing = await d.objects.read(
          reservation.objectKey,
          reservation.reservedBytes,
        );
        if (!sameFileBytes(existing, stored)) throw createAppError('CONFLICT');
        return { fileId: reservation.id, generation: reservation.generation };
      }
      await d.objects.put(reservation.objectKey, stored);
      requireFileAttempt(startedAt, d.clock.now(), policy.serviceMs);
      await frame.quarantine(token, stored.byteLength, d.clock.now());
      return { fileId: reservation.id, generation: reservation.generation };
    });
  } catch (error) {
    if (cleanup) await cleanupPending(d, scope, token);
    throw isAppError(error) ? error : createAppError('INFRASTRUCTURE');
  }
}
export async function finalizeMessagingFile(
  input: unknown,
  principal: AuthorizationPrincipal,
  d: FileDependencies,
) {
  const { policy, identity } = context(principal, d);
  const command = parseValidated(
    createMessagingFileSchemas(policy).finalize,
    input,
  );
  const scope = { ...identity, channelId: command.channelId };
  const token = { fileId: command.fileId, generation: command.generation };
  let committing = false;
  try {
    const startedAt = d.clock.now();
    // Fresh post before any protected metadata/object read. Finalization repeats it after scanning.
    const reservation = await d.store.withChannel(scope, 'post', (frame) =>
      frame.scan(token, d.clock.now()),
    );
    const attempt = token;
    if (reservation.lifecycle === 'attached') {
      await d.store.withChannel(scope, 'post', (frame) =>
        frame.finalize(token, command.messageId, d.clock.now(), policy),
      );
      return token;
    }
    const bytes = await d.objects.read(
      reservation.objectKey,
      policy.maxFileBytes,
    );
    requireFileSignature(bytes, reservation.mime);
    if (
      (await d.scanner.scan(bytes, {
        maxBytes: policy.maxFileBytes,
        serviceMs: policy.serviceMs,
      })) !== 'clean'
    )
      throw createAppError('VALIDATION');
    committing = true;
    await d.store.withChannel(scope, 'post', (frame) => {
      requireFileAttempt(startedAt, d.clock.now(), policy.serviceMs);
      return frame.finalize(attempt, command.messageId, d.clock.now(), policy);
    });
    return { fileId: command.fileId, generation: attempt.generation };
  } catch (error) {
    if (
      !committing ||
      (isAppError(error) && ['AUTHORIZATION', 'CONFLICT'].includes(error.code))
    )
      await cleanupPending(d, scope, token);
    throw isAppError(error) ? error : createAppError('INFRASTRUCTURE');
  }
}
export async function readMessagingFile(
  input: unknown,
  principal: AuthorizationPrincipal,
  d: FileDependencies,
) {
  const { policy, identity } = context(principal, d);
  const command = parseValidated(
    createMessagingFileSchemas(policy).access,
    input,
  );
  return d.store.withChannel(
    { ...identity, channelId: command.channelId },
    'read',
    async (frame) => {
      const token = { fileId: command.fileId, generation: command.generation };
      const access = await frame.access(token, d.clock.now(), policy);
      const bytes = await d.objects.read(access.objectKey, access.storedBytes);
      await frame.access(token, d.clock.now(), policy);
      if (Date.parse(d.clock.now()) >= Date.parse(access.accessExpiresAt))
        throw createAppError('NOT_FOUND');
      return {
        bytes,
        filename: access.filename,
        mime: access.mime,
        expiresAt: access.accessExpiresAt,
      };
    },
  );
}
export async function cancelMessagingFile(
  input: unknown,
  principal: AuthorizationPrincipal,
  d: FileDependencies,
) {
  const { identity, policy } = context(principal, d);
  const command = parseValidated(
    createMessagingFileSchemas(policy).cancel,
    input,
  );
  await d.store.withChannel(
    { ...identity, channelId: command.channelId },
    'post',
    (frame) =>
      frame.cancel({ fileId: command.fileId, generation: command.generation }),
  );
}

export async function renewMessagingFile(
  input: unknown,
  principal: AuthorizationPrincipal,
  d: FileDependencies,
) {
  const { identity, policy } = context(principal, d);
  const command = parseValidated(
    createMessagingFileSchemas(policy).access,
    input,
  );
  return d.store.withChannel(
    { ...identity, channelId: command.channelId },
    'post',
    async (frame) =>
      publicReservation(
        await frame.renew(
          { fileId: command.fileId, generation: command.generation },
          d.clock.now(),
          policy,
        ),
      ),
  );
}
