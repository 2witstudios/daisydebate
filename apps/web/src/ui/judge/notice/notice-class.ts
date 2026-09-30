export type NoticeTone = 'accent' | 'gold' | 'neutral';

const base = 'flex items-start gap-3 rounded-lg px-4 py-3';

const tones: Readonly<Record<NoticeTone, string>> = {
  accent: 'bg-accent-soft',
  gold: 'bg-gold-soft',
  neutral: 'bg-surface-overlay',
};

const icons: Readonly<Record<NoticeTone, string>> = {
  accent: 'mt-1 text-accent',
  gold: 'mt-1 text-gold',
  neutral: 'mt-1 text-ink-muted',
};

export const noticeClass = (tone: NoticeTone): string =>
  `${base} ${tones[tone]}`;

export const noticeIconClass = (tone: NoticeTone): string => icons[tone];
