import type { Speech } from './case';
import type { ExportFormat, ExportOption } from './case-query';

export type ExportChoiceDef = {
  readonly id: ExportFormat;
  readonly label: string;
  readonly help: string;
};

export type ExportSettingDef = {
  readonly id: ExportOption;
  readonly label: string;
  readonly help: string | null;
};

export const exportChoices: readonly ExportChoiceDef[] = [
  {
    id: 'speech',
    label: 'Speech document',
    help: 'One section per speech, cards in full, large type.',
  },
  {
    id: 'flow',
    label: 'Flow sheet',
    help: 'Outline only: tag lines and claims, one page.',
  },
  {
    id: 'cards',
    label: 'Cards packet',
    help: 'Every card with its full citation, no brief text.',
  },
];

export const exportSettings: readonly ExportSettingDef[] = [
  { id: 'cite', label: 'Full citation under each card', help: null },
  { id: 'break', label: 'Start each speech on a new page', help: null },
  {
    id: 'large',
    label: 'Large type for reading aloud',
    help: 'Large body text',
  },
  {
    id: 'notes',
    label: 'Include my private notes',
    help: 'Off. Notes stay out unless you turn this on.',
  },
  {
    id: 'cred',
    label: 'Include credibility notes',
    help: 'Off. These are for you, not for a file you hand around.',
  },
];

/** What the export's first page would hold, as plain lines. */
export function previewLines(
  format: ExportFormat,
  options: readonly ExportOption[],
  speech: Speech,
): readonly string[] {
  const named = speech.blocks.filter((b) => !b.removed);
  const lines = named
    .filter((b) =>
      format === 'cards'
        ? b.kind === 'card'
        : format === 'flow'
          ? b.kind !== 'note'
          : true,
    )
    .map((b) =>
      format === 'flow' && b.text !== undefined
        ? `${b.title}: ${b.text}`
        : b.title,
    );
  return [
    `${speech.label.toUpperCase()} · [SPEECH TIME]`,
    ...lines,
    ...(options.includes('cite') && format !== 'flow'
      ? ['Full citation under each card']
      : []),
    ...(options.includes('notes') ? ['Private notes included'] : []),
    ...(options.includes('cred') ? ['Credibility notes included'] : []),
  ];
}
