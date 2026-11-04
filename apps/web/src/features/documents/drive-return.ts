import { isAppError } from '@daisy/errors';

/** The pages a drive form may return to. Anything else goes to Prep. */
const RETURN_PATHS = [
  /^\/prep$/,
  /^\/prep\/folders\/[a-z0-9]{24}$/,
  /^\/rounds\/[a-z0-9]{24}(\/room)?$/,
];

export const returnPath = (value: string | null): string =>
  value !== null && RETURN_PATHS.some((path) => path.test(value))
    ? value
    : '/prep';

/** The fixed answers a form refusal can show; a key never holds typed text. */
export const driveNotices = {
  'name-length': 'A name needs between 1 and 120 characters.',
  missing: 'That is no longer in your drive.',
  conflict: 'That change is not possible: the drive is full or too deep.',
  refused: 'That change was refused.',
} as const;
export type DriveNoticeKey = keyof typeof driveNotices;

export const driveNoticeOf = (error: unknown): DriveNoticeKey => {
  if (!isAppError(error)) return 'refused';
  if (error.code === 'VALIDATION') return 'name-length';
  if (error.code === 'NOT_FOUND') return 'missing';
  if (error.code === 'CONFLICT') return 'conflict';
  return 'refused';
};

/** A notice from the URL, only ever compared with the keys above. */
export const driveNoticeText = (value: unknown): string | null =>
  typeof value === 'string' && Object.hasOwn(driveNotices, value)
    ? driveNotices[value as DriveNoticeKey]
    : null;
