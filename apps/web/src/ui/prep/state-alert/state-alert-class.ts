import type { NoticeTone } from '../../../features/prep/notices';

const base = 'flex items-start gap-3 rounded-md border p-4';

const tones: Readonly<Record<NoticeTone, string>> = {
  danger: 'border-live bg-live-soft',
  warning: 'border-gold-border bg-gold-soft',
  info: 'border-border-strong bg-accent-soft',
};

const icons: Readonly<Record<NoticeTone, string>> = {
  danger: 'text-live',
  warning: 'text-gold',
  info: 'text-accent',
};

/** The alert box: a tinted fill and border by tone. */
export const stateAlertClass = (tone: NoticeTone): string =>
  `${base} ${tones[tone]}`;

/** The tone's colour for the leading icon. */
export const stateIconClass = (tone: NoticeTone): string => icons[tone];

/**
 * The destructive action: a red outline. It carries the full button shape
 * itself because the shared secondary button sets its own border colour.
 */
export const dangerButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-live bg-transparent px-5 py-3 text-base leading-tight font-strong text-live transition-colors duration-120 ease-standard disabled:cursor-not-allowed disabled:opacity-60';
