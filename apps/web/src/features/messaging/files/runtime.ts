import type { FilePolicy } from '@daisy/db/messaging-files';
import type { ImageSanitizer, PrivateObjectStore, FileScanner } from './ports';
/** Ports and approved budgets are explicitly injected at the deployment edge. */
export type MessagingFileRuntime = {
  readonly policy: FilePolicy;
  /** Optional trusted cleanup; explicitly configured, never a retention-policy default. */
  readonly maintenance?: {
    readonly intervalMs: number;
    readonly maxItems: number;
  };
  readonly maxMultipartBytes: number;
  readonly objects: PrivateObjectStore;
  readonly scanner: FileScanner;
  readonly sanitizeImage: ImageSanitizer;
};
