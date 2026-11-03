import { isTemporaryRefusal } from '@daisy/db/capacity';

/**
 * Stakes beside a live room never outrank its controls: a temporary refusal
 * only omits them for this render. Any other failure still throws.
 */
export async function ratingsUnlessRefused<View>(
  read: () => Promise<View | null>,
): Promise<View | null> {
  try {
    return await read();
  } catch (error) {
    if (!isTemporaryRefusal(error)) throw error;
    return null;
  }
}
