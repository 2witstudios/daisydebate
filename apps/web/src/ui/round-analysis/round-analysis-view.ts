import type {
  RoundAnalysisLine,
  RoundAnalysisReport,
  RoundAnalysisSkill,
  RoundAnalysisView,
} from '@daisy/protocol';

/** A transcript line the report may cite, as the page's own transcript read gives it. */
export type CitedLine = RoundAnalysisLine & {
  readonly speaker: string;
  readonly text: string;
};

const skillNames: Record<RoundAnalysisSkill, string> = {
  refutation: 'Refutation',
  extension: 'Extension',
  weighing: 'Weighing',
  evidence: 'Evidence',
  crossExamination: 'Cross-examination',
  structure: 'Structure',
};

export type RoundAnalysisPanel =
  | {
      readonly kind: 'report';
      readonly summary: string;
      readonly improvements: readonly string[];
      readonly keyMoments: readonly {
        readonly quote: CitedLine | null;
        readonly happened: string;
        readonly mattered: string;
        readonly strongestReply: string;
      }[];
      readonly missedOpportunities: readonly {
        readonly quote: CitedLine | null;
        readonly argument: string;
        readonly reply: string;
      }[];
      readonly skills: readonly {
        readonly name: string;
        readonly score: number;
        readonly note: string;
      }[];
      readonly patterns: readonly string[];
    }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'locked'; readonly text: string };

const quoteOf = (lines: readonly CitedLine[], line: RoundAnalysisLine) =>
  lines.find(
    (candidate) =>
      candidate.segment === line.segment &&
      candidate.sequence === line.sequence,
  ) ?? null;

function reportPanel(
  report: RoundAnalysisReport,
  lines: readonly CitedLine[],
): RoundAnalysisPanel {
  return {
    kind: 'report',
    summary: report.summary,
    improvements: report.improvements,
    keyMoments: report.keyMoments.map(({ line, ...moment }) => ({
      quote: quoteOf(lines, line),
      ...moment,
    })),
    missedOpportunities: report.missedOpportunities.map(
      ({ line, ...missed }) => ({ quote: quoteOf(lines, line), ...missed }),
    ),
    skills: (Object.keys(skillNames) as RoundAnalysisSkill[]).map((skill) => ({
      name: skillNames[skill],
      ...report.skills[skill],
    })),
    patterns: report.patterns,
  };
}

/** What the round analysis card shows for each state of the debater's own view. */
export function roundAnalysisPanel(
  view: RoundAnalysisView,
  lines: readonly CitedLine[],
): RoundAnalysisPanel {
  switch (view.status) {
    case 'ready':
      return reportPanel(view.report, lines);
    case 'pending':
      return {
        kind: 'note',
        text: 'Your round analysis is being written. Reload this page in a minute.',
      };
    case 'unavailable':
      return {
        kind: 'note',
        text: 'Round analysis is not available for this round.',
      };
    case 'locked':
      return {
        kind: 'locked',
        text: 'Round analysis is premium: the key moments of your round, the strongest reply at each, the openings you missed, and a score for every skill.',
      };
  }
}
