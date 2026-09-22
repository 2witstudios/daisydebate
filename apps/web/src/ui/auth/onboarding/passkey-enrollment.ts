/** How offering to save a passkey ended. Only `saved` is a success. */
export type PasskeyEnrollment =
  | { readonly kind: 'saved' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'unavailable' };

/**
 * The seam AUTH-5.x fills with the real registration ceremony. Until then it
 * reports `unavailable`, and the offer says so: enrolling is never faked.
 */
export type PasskeyEnrollmentSeam = {
  readonly enroll: () => Promise<PasskeyEnrollment>;
};

export const passkeyEnrollmentNotYetAvailable: PasskeyEnrollmentSeam = {
  enroll: () => Promise.resolve({ kind: 'unavailable' }),
};

/** A seam that throws is a failure, never a false success. */
export const enrollSafely = async (
  seam: PasskeyEnrollmentSeam,
): Promise<PasskeyEnrollment> => {
  try {
    return await seam.enroll();
  } catch {
    return { kind: 'failed' };
  }
};

/** What each unfinished offer tells the person. */
export const enrollmentNotices: Readonly<
  Record<Exclude<PasskeyEnrollment['kind'], 'saved'>, string>
> = {
  unavailable:
    'Saving a passkey is not available yet, so nothing was saved. Email links keep working.',
  cancelled: 'Nothing was saved. You can try again or continue.',
  failed: 'We could not save a passkey. Email links keep working.',
};
