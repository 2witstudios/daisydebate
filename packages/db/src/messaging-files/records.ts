export type FileMime =
  'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
export type FilePolicy = Readonly<{
  maxFileBytes: number;
  maxStoredBytes: number;
  maxStoredFiles: number;
  maxFilesPerMessage: number;
  reservationMs: number;
  accessMs: number;
  maxFilenameUnits: number;
  maxImagePixels: number;
  serviceMs: number;
}>;
export type FileScope = Readonly<{
  channelId: string;
  actorId: string;
  userId: string;
}>;
export type FileReservation = Readonly<{
  lifecycle: 'reserved' | 'quarantined' | 'attached';
  id: string;
  channelId: string;
  ownerActorId: string;
  objectKey: string;
  filename: string;
  mime: FileMime;
  reservedBytes: number;
  generation: number;
  authorityRevision: number;
  expiresAt: string;
}>;
export type FileToken = Readonly<{ fileId: string; generation: number }>;
export type FileAccess = FileReservation &
  Readonly<{ messageId: string; storedBytes: number; accessExpiresAt: string }>;
export type FileReserveCommand = Readonly<{
  id: string;
  objectKey: string;
  requestId: string;
  filename: string;
  mime: FileMime;
  bytes: number;
}>;
export type FileFrame = {
  reserve(
    command: FileReserveCommand,
    now: string,
    policy: FilePolicy,
  ): Promise<FileReservation>;
  upload(token: FileToken, now: string): Promise<FileReservation>;
  scan(token: FileToken, now: string): Promise<FileReservation>;
  quarantine(token: FileToken, bytes: number, now: string): Promise<void>;
  renew(
    token: FileToken,
    now: string,
    policy: FilePolicy,
  ): Promise<FileReservation>;
  finalize(
    token: FileToken,
    messageId: string,
    now: string,
    policy: FilePolicy,
  ): Promise<void>;
  access(
    token: FileToken,
    now: string,
    policy: FilePolicy,
  ): Promise<FileAccess>;
  cancel(token: FileToken): Promise<void>;
};
export type FileStore = {
  withChannel<T>(
    scope: FileScope,
    capability: 'post' | 'read',
    work: (frame: FileFrame) => Promise<T>,
  ): Promise<T>;
};
