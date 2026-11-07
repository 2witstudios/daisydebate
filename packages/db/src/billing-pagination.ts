import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

export type BillingPage = {
  readonly mode: 'test' | 'live';
  readonly afterId?: string;
  readonly limit: number;
};

export function checkBillingPage(input: BillingPage) {
  if (
    !['test', 'live'].includes(input.mode) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    (input.afterId !== undefined && !idSchema.safeParse(input.afterId).success)
  )
    throw createAppError('VALIDATION');
}
