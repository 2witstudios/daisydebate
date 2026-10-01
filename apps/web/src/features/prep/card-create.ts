import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import {
  citationCompleteness,
  readWords,
  type CitationFields,
  type Completeness,
  type Segment,
} from './card';
import { getDraftSegments } from './get-draft';
import { importSource, type ImportOutcome } from './import-source';
import {
  citationIncomplete,
  importDuplicate,
  importLoginWall,
  importScanPdf,
  importUnreachable,
  type Notice,
} from './notices';
import { formatClock, readSeconds, wordCount } from './reading-time';

const steps = ['source', 'highlight', 'cite'] as const;
const sources = ['paste', 'link', 'file'] as const;
const tools = ['read', 'keep', 'clear'] as const;

type CreateStep = (typeof steps)[number];
type SourceMode = (typeof sources)[number];
export type MarkTool = (typeof tools)[number];

export type CardCreateQuery = {
  readonly step: CreateStep;
  readonly src: SourceMode;
  readonly tool: MarkTool;
  /** The link given to the importer. */
  readonly url: string;
};

const defaults: CardCreateQuery = {
  step: 'source',
  src: 'paste',
  tool: 'read',
  url: '',
};

const MAX_URL_LENGTH = 500;

const schema = z.object({
  step: z.enum(steps).catch(defaults.step),
  src: z.enum(sources).catch(defaults.src),
  tool: z.enum(tools).catch(defaults.tool),
  url: z
    .string()
    .transform((value) => value.trim().slice(0, MAX_URL_LENGTH))
    .catch(defaults.url),
});

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Reads the creation flow's URL state; bad values become defaults. */
export function parseCardCreateQuery(params: SearchParams): CardCreateQuery {
  return schema.parse({
    step: first(params['step']),
    src: first(params['src']),
    tool: first(params['tool']),
    url: first(params['url']),
  });
}

export function cardCreateHref(query: CardCreateQuery): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults) as (keyof CardCreateQuery)[])
    if (query[key] !== defaults[key]) params.set(key, query[key]);
  const search = params.toString();
  return search === '' ? '/prep/cards/new' : `/prep/cards/new?${search}`;
}

const stepLabels: Readonly<Record<CreateStep, string>> = {
  source: 'Source',
  highlight: 'Highlight',
  cite: 'Cite and save',
};

const sourceLabels: Readonly<Record<SourceMode, string>> = {
  paste: 'Paste text',
  link: 'Import from link',
  file: 'Upload a file',
};

export type CardCreateView = {
  readonly query: CardCreateQuery;
  readonly steps: readonly {
    readonly id: CreateStep;
    readonly number: number;
    readonly label: string;
    readonly href: string;
    readonly current: boolean;
  }[];
  readonly sourceModes: readonly {
    readonly id: SourceMode;
    readonly label: string;
    readonly href: string;
    readonly current: boolean;
  }[];
  readonly backHref: string | null;
  readonly nextHref: string | null;
  readonly outcome: ImportOutcome;
  /** The import problem to show, when the link did not simply fetch. */
  readonly notice: Notice | null;
  readonly draft: {
    readonly text: string;
    readonly segments: readonly Segment[];
    readonly wordsDetected: number;
    readonly readWords: number;
    readonly readClock: string;
  };
  readonly cite: {
    readonly fields: CitationFields;
    readonly completeness: Completeness;
    readonly notice: Notice | null;
  };
  readonly paceLabel: string;
};

const stepIndex = (step: CreateStep): number => steps.indexOf(step);

function noticeFor(
  outcome: ImportOutcome,
  query: CardCreateQuery,
): Notice | null {
  const paste = cardCreateHref({ ...query, src: 'paste', url: '' });
  const file = cardCreateHref({ ...query, src: 'file', url: '' });
  switch (outcome.kind) {
    case 'unreachable':
      return importUnreachable(cardCreateHref(query), paste);
    case 'login-wall':
      return importLoginWall(outcome.words, paste, file);
    case 'scan-pdf':
      return importScanPdf(file);
    case 'duplicate':
      return importDuplicate(
        `/prep/cards/${outcome.cardId}`,
        outcome.cardTitle,
        outcome.savedOn,
        cardCreateHref({ ...query, step: 'highlight', url: '' }),
      );
    default:
      return null;
  }
}

/**
 * The creation flow's one mock driver: it maps the URL (step, source mode,
 * marking tool, link) to everything the three steps show. There is no draft
 * store yet, so the source and citation are sample values; the real draft
 * replaces the `draft` and `cite` fields here and the screens do not change.
 */
export function cardCreateView(
  query: CardCreateQuery,
  pace: number,
): CardCreateView {
  const current = stepIndex(query.step);
  const outcome: ImportOutcome =
    query.src === 'link' ? importSource(query.url) : { kind: 'idle' };
  const segments = getDraftSegments();
  const fields: CitationFields = {
    author: '[Author A]',
    qualifications: '[Role, institution]',
    publication: '[Publication]',
    title: '[Title]',
    published: '',
    url:
      query.src === 'link' && query.url !== ''
        ? query.url
        : 'https://example.org/[path]',
    credibilityNotes: '',
  };
  const completeness = citationCompleteness(fields);
  const words = readWords(segments);
  return {
    query,
    steps: steps.map((id, index) => ({
      id,
      number: index + 1,
      label: stepLabels[id],
      href: cardCreateHref({ ...query, step: id }),
      current: index === current,
    })),
    sourceModes: sources.map((id) => ({
      id,
      label: sourceLabels[id],
      href: cardCreateHref({ ...query, step: 'source', src: id }),
      current: id === query.src,
    })),
    backHref:
      current === 0
        ? null
        : cardCreateHref({ ...query, step: steps[current - 1] ?? 'source' }),
    nextHref:
      current === steps.length - 1
        ? null
        : cardCreateHref({ ...query, step: steps[current + 1] ?? 'cite' }),
    outcome,
    notice: noticeFor(outcome, query),
    draft: {
      text: segments.map((segment) => segment.text).join(''),
      segments,
      wordsDetected: wordCount(
        segments.map((segment) => segment.text).join(''),
      ),
      readWords: words,
      readClock: formatClock(readSeconds(words, pace)),
    },
    cite: {
      fields,
      completeness,
      notice: completeness.missing.includes('publication date')
        ? citationIncomplete('publication date')
        : null,
    },
    paceLabel: `[${pace}]`,
  };
}
