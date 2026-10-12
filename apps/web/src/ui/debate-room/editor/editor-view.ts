/** View-only text sizes for the open document; the stored file never changes. */
export const textSizes = ['sm', 'md', 'lg', 'xl'] as const;
export type TextSize = (typeof textSizes)[number];

export const DEFAULT_TEXT_SIZE: TextSize = 'md';

/** One step smaller or larger, held at the ends. */
export function stepTextSize(size: TextSize, step: -1 | 1): TextSize {
  const at = textSizes.indexOf(size) + step;
  return textSizes[Math.min(Math.max(at, 0), textSizes.length - 1)]!;
}

/**
 * The toolbar's roving focus (one tab stop, arrows move within it): the
 * index a key moves focus to, or null when the key is not the toolbar's.
 */
export function toolbarFocus(
  key: string,
  index: number,
  count: number,
): number | null {
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
