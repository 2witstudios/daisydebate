import type { Brief } from './brief';
import { briefHtml, type BriefEvidence } from './brief-document';

export type BriefEditorView = {
  readonly id: string;
  readonly title: string;
  readonly side: Brief['side'];
  readonly motion: string;
  /** The brief as the editor's document HTML. */
  readonly html: string;
  readonly savedLabel: string;
  /** Who can read it: "Private to you" or "Shared with <team>". */
  readonly accessLabel: string;
  readonly evidence: readonly BriefEvidence[];
  readonly pace: number;
  readonly limitSeconds: number;
  readonly reviewHref: string;
  readonly shareHref: string;
};

/** The editor's one driver: a brief, the quotable evidence and the rules. */
export function briefEditorView(
  brief: Brief,
  evidence: readonly BriefEvidence[],
  pace: number,
  limitSeconds: number,
): BriefEditorView {
  return {
    id: brief.id,
    title: brief.title,
    side: brief.side,
    motion: brief.motion,
    html: briefHtml(brief, evidence),
    savedLabel:
      brief.savedAt === '' ? 'Not saved yet' : `Saved ${brief.savedAt}`,
    accessLabel:
      brief.visibility.kind === 'team'
        ? `Shared with ${brief.visibility.teamName}`
        : 'Private to you',
    evidence,
    pace,
    limitSeconds,
    reviewHref: `/prep/briefs/${brief.id}/review`,
    shareHref: `/prep/briefs/${brief.id}/review?share=open`,
  };
}
