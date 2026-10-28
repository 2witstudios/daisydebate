import type { FilePolicy } from '@daisy/db/messaging-files';
import type { ImageSanitizer, PrivateObjectStore, FileScanner } from './ports';
/** Ports and approved budgets are explicitly injected at the deployment edge. */
export type MessagingFileRuntime = {
  /** The deployment's file budgets; the day's upload count is DEC-251's. */
  readonly policy: Omit<FilePolicy, 'maxUploadsPerDay'>;
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
