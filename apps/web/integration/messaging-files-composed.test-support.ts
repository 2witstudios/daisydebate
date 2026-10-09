import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { socialPolicyEvidence } from '@daisy/auth/social-policy';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { FilePolicy, FileMime } from '@daisy/db/messaging-files';
import { openMessagingFixture } from './messaging-fixture.test-support';
import {
  openFileScannerRelay,
  controlledFileScan,
} from './messaging-files.test-support';
import { composeMessagingFileStore } from '../src/features/messaging/file-composition';
import {
  messagingAuthorizationFence,
  type MessagingReadingPolicy,
} from '../src/features/messaging/authorization-fence';
import { mutateMessagingMessage } from '../src/features/messaging/mutate';
import { composeMessagingFileCleanup } from '../src/features/messaging/file-cleanup';
import { createLocalPrivateObjectStore } from '../src/features/messaging/files/local-object-store';
import { createClamdScanner } from '../src/features/messaging/files/clamd';
import { sanitizeMessagingImage } from '../src/features/messaging/files/image-sanitizer';
import {
  finalizeMessagingFile,
  reserveMessagingFile,
  uploadMessagingFile,
  type FileDependencies,
} from '../src/features/messaging/files/operations';

// Explicit integration-only policy, never production activation or numeric defaults.
export const fileProofPolicy: FilePolicy = {
  maxFileBytes: 4096,
  maxStoredBytes: 16384,
  maxStoredFiles: 4,
  maxFilesPerMessage: 2,
  reservationMs: 60000,
  accessMs: 1000,
  maxFilenameUnits: 80,
  maxImagePixels: 100,
  serviceMs: 5000,
};
export const cleanFilePdf = new TextEncoder().encode(
  '%PDF-1.7\nclean document\n%%EOF',
);
export async function openComposedFileFixture(
  databaseUrl: string,
  port: number,
  group = false,
) {
  const opened = await openMessagingFixture(databaseUrl);
  const directory = await mkdtemp(join(tmpdir(), 'daisy-file-proof-'));
  const relay = await openFileScannerRelay({ host: '127.0.0.1', port });
  const { fixture, client, database, principal } = opened;
  const close = async () => {
    try {
      await client.unsafe('delete from messaging_files where channel_id=$1', [
        fixture.channelId,
      ]);
      await fixture.cleanup();
    } finally {
      await Promise.all([
        relay.close(),
        database.close(),
        client.close(),
        rm(directory, { recursive: true, force: true }),
      ]);
    }
  };
  try {
    if (group) {
      await client.unsafe(
        'delete from messaging_dm_pairs where channel_id=$1',
        [fixture.channelId],
      );
      await client.unsafe(
        "update messaging_channels set kind='private_group',policy_key='social.private_group' where id=$1",
        [fixture.channelId],
      );
      await client.unsafe(
        "insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values($1,$2,'manager',1,$4),($1,$3,'member',1,$4)",
        [fixture.channelId, fixture.actorId, fixture.otherActorId, fixture.now],
      );
    }
    const clock = { now: () => fixture.now };
    const objects = createLocalPrivateObjectStore(directory);
    const readingPolicy: MessagingReadingPolicy = (input) => ({
      ...socialPolicyEvidence(input.channel, input.accounts, input.now),
      allowed: true,
    });
    const dependenciesFor = (
      identity: AuthorizationPrincipal,
    ): FileDependencies => ({
      policy: fileProofPolicy,
      store: composeMessagingFileStore({
        database,
        principal: identity,
        clock,
        postingPolicy: {
          state: 'approved',
          decision: 'Explicit file integration fixture only',
          key: group ? 'social.private_group' : 'social.dm',
          revision: 1,
          allowedBandPairs: [['adult', 'adult']],
        },
        readingPolicy,
      }),
      failPending: composeMessagingFileCleanup({
        database,
        principal: identity,
      }),
      objects,
      scanner: createClamdScanner(relay),
      sanitizeImage: sanitizeMessagingImage,
      clock,
      ids: { next: createId },
    });
    const removeMessage = () =>
      mutateMessagingMessage(
        'remove',
        {
          version: 1,
          channelId: fixture.channelId,
          messageId,
          requestId: createId(),
        },
        principal,
        {
          bounds: { messageUnits: 100, pageItems: 20 },
          editWindowMs: 1,
          clock,
          limit: async () => {},
          store: database.messagingChannelStore(
            messagingAuthorizationFence({
              principal,
              capability: 'channel.message.remove',
              clock,
              postingPolicy: { state: 'pending' },
              readingPolicy,
            }),
          ),
        },
      );
    const dependencies = dependenciesFor(principal);
    const reserve = (
      bytes = cleanFilePdf,
      mime: FileMime = 'application/pdf',
      filename = 'notes.pdf',
    ) =>
      reserveMessagingFile(
        {
          version: 1,
          channelId: fixture.channelId,
          requestId: createId(),
          bytes: bytes.length,
          mime,
          filename,
        },
        principal,
        dependencies,
      );
    const quarantine = async (
      bytes = cleanFilePdf,
      mime: FileMime = 'application/pdf',
      filename = 'notes.pdf',
    ) => {
      const reserved = await reserve(bytes, mime, filename);
      const token = {
        version: 1,
        channelId: fixture.channelId,
        fileId: reserved.fileId,
        generation: reserved.generation,
      };
      await uploadMessagingFile(token, bytes, principal, dependencies);
      return token;
    };
    const messageId = createId();
    await client.unsafe(
      "insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values($1,$2,$3,1,1,'File message',$4)",
      [messageId, fixture.channelId, fixture.actorId, fixture.now],
    );
    await client.unsafe(
      'update messaging_channels set message_sequence=1,change_version=1 where id=$1',
      [fixture.channelId],
    );
    const fileRow = async (fileId: string) =>
      (
        await client.unsafe(
          'select lifecycle,generation::int as generation,filename,mime,request_id,message_id,object_key from messaging_files where id=$1',
          [fileId],
        )
      )[0]!;
    return {
      ...opened,
      relay,
      objects,
      dependencies,
      dependenciesFor,
      reserve,
      quarantine,
      messageId,
      removeMessage,
      fileRow,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export function startFileFinalization(
  f: Pick<
    Awaited<ReturnType<typeof openComposedFileFixture>>,
    'dependencies' | 'principal' | 'messageId'
  >,
  token: {
    version: number;
    channelId: string;
    fileId: string;
    generation: number;
  },
) {
  const scan = controlledFileScan(f.dependencies.scanner);
  return {
    ...scan,
    finalizing: finalizeMessagingFile(
      { ...token, messageId: f.messageId },
      f.principal,
      { ...f.dependencies, scanner: scan.scanner },
    ),
  };
}
