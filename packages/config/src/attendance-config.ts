import { z } from 'zod';
import { secret } from './secrets';

export const attendanceFields = {
  /** Configured isolated member/session resource for the actual public check-in probe. */
  ATTENDANCE_PUBLIC_PROBE: secret(z.string()).optional(),
};
