export type StageButtonVariant = 'primary' | 'secondary';

const base =
  'inline-flex items-center justify-center rounded-sm border px-5 py-3 text-base leading-tight font-heavy no-underline transition-colors duration-120 ease-standard hover:no-underline';

const variants: Readonly<Record<StageButtonVariant, string>> = {
  primary:
    'border-transparent bg-stage-accent text-stage-accent-ink hover:bg-stage-accent-strong',
  secondary: 'border-stage-ink-muted text-stage-ink hover:border-stage-ink',
};

/** Buttons on the dark stage card, where page-colored ones would vanish. */
export const stageButtonClass = (variant: StageButtonVariant): string =>
  `${base} ${variants[variant]}`;
