import { PrepIcon } from '../prep-icon/prep-icon';

/** The accent-tinted lock note that says prep is the owner's alone. */
export function PrivacyNote({ children }: { readonly children: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-accent-soft p-4 text-sm text-ink">
      <PrepIcon name="lock" size={16} className="mt-1 text-accent" />
      {children}
    </p>
  );
}
