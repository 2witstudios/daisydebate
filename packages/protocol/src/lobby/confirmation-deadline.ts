import { addMs } from '@daisy/clock';
import { z } from 'zod';

/** Server-owned operational validity; competition settings and clients cannot extend it. */
export const TAB_CONFIRMATION_VALIDITY_MS = 300_000;
/** The caller injects authoritative UTC issuance time. Invalid input creates no proposal. */
export const confirmationDeadline = (issuedAt: string): string | null =>
  z.iso.datetime().safeParse(issuedAt).success
    ? addMs(issuedAt, TAB_CONFIRMATION_VALIDITY_MS)
    : null;
