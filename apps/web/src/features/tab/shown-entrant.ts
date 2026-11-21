import type { ShownEntrant } from '@daisy/protocol/lobby/posting-read';

/** An entrant as the viewer may see them: their name, or their initials. */
export const shownName = (shown: ShownEntrant): string =>
  shown.kind === 'name' ? shown.name : shown.initials;

/** Public results use initials so a posting does not publish the entry's registered name. */
export const showTournamentEntrant = (
  name: string,
  allowName: boolean,
): ShownEntrant => {
  if (allowName) return { kind: 'name', name };
  const initials = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/\s+/)
    .flatMap((word) => {
      const first = /^[A-Z]/.exec(word.toLocaleUpperCase('en-US'))?.[0];
      return first ? [`${first}.`] : [];
    })
    .slice(0, 4)
    .join(' ');
  return { kind: 'initials', initials: initials || 'X.' };
};
