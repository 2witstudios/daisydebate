import Link from 'next/link';
import { prepDestinations } from '../../../features/prep/actions';
import { PrepIcon } from '../prep-icon/prep-icon';

/** The accent-tinted lock note that says prep is the owner's alone. */
export function PrivacyNote() {
  return (
    <p className="flex items-center gap-2 rounded-lg bg-accent-soft p-4 text-sm text-ink">
      <PrepIcon name="lock" size={16} className="text-accent" />
      Private to you.
      <Link href={prepDestinations.privacy}>Privacy</Link>
    </p>
  );
}
