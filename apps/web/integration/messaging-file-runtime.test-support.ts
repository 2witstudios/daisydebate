import { createClamdScanner } from '../src/features/messaging/files/clamd';
import { createLocalPrivateObjectStore } from '../src/features/messaging/files/local-object-store';
import { sanitizeMessagingImage } from '../src/features/messaging/files/image-sanitizer';
import type { MessagingFileRuntime } from '../src/features/messaging/files/runtime';
/** Explicit isolated mounted/browser budgets and real vendors, never deploy-time defaults. */
export function messagingFileProofRuntime(
  directory: string,
  port: number,
): MessagingFileRuntime {
  return {
    maxMultipartBytes: 8192,
    policy: {
      maxFileBytes: 4096,
      maxStoredBytes: 16384,
      maxStoredFiles: 4,
      maxFilesPerMessage: 2,
      reservationMs: 60000,
      accessMs: 1000,
      maxFilenameUnits: 80,
      maxImagePixels: 100,
      serviceMs: 5000,
    },
    objects: createLocalPrivateObjectStore(directory),
    scanner: createClamdScanner({ host: '127.0.0.1', port }),
    sanitizeImage: sanitizeMessagingImage,
  };
}
