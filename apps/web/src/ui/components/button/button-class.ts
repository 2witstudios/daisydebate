export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'on-media';

// Variants never override the base: each owns its padding, so no two classes
// on one element ever set the same property.
const base =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm border text-base leading-tight font-strong transition-colors duration-120 ease-standard disabled:cursor-not-allowed disabled:opacity-60';

const variants: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'border-transparent bg-accent px-5 py-3 text-accent-ink hover:bg-accent-strong',
  secondary:
    'border-border-strong bg-transparent px-5 py-3 text-ink hover:border-ink-muted hover:text-ink',
  ghost:
    'border-transparent bg-transparent px-3 py-2 text-ink-muted hover:text-ink',
  // Secondary action over a photograph: an opaque raised surface, so its ink
  // label reads in both schemes instead of the transparent outline's.
  'on-media':
    'border-transparent bg-surface-raised px-5 py-3 text-ink hover:bg-surface-sunken',
};

/** Classes for a button of the given variant. */
export const buttonClass = (variant: ButtonVariant): string =>
  `${base} ${variants[variant]}`;
