import type { BallotDefinition } from '@daisy/protocol/ballot-definition';

const scoreSubjects = {
  side: 'Each side',
  seat: 'Each speaker',
  speech: 'Each individual speech',
} as const;
const writtenLabel = (rule: BallotDefinition['written']['reason']) =>
  rule === null
    ? 'Off'
    : `${rule.required ? 'Required' : 'Optional'} · up to ${rule.max} characters`;
/** Read-only canonical content remains visible even to a host who cannot publish. */
export function BallotDefinitionSummary({
  definition,
  segments,
}: {
  readonly definition: BallotDefinition;
  readonly segments: readonly {
    readonly key: string;
    readonly label: string;
  }[];
}) {
  const { decision, points, written } = definition;
  const outcome =
    decision.kind === 'winner'
      ? [
          'Winner between sides',
          ...(decision.tie ? ['ties allowed'] : []),
          ...(decision.doubleLoss ? ['double loss allowed'] : []),
          ...(decision.lowPointWin ? ['winner may have fewer points'] : []),
        ].join(' · ')
      : `Rank ${decision.of}${decision.ties ? ' · ties allowed' : ' · no ties'}`;
  const lines = [
    ['Decision', outcome],
    [
      'Speaker ranking',
      definition.speakerRanks
        ? 'Every speaker is ranked individually'
        : 'No additional speaker ranking',
    ],
    [
      'Scores',
      points
        ? `${scoreSubjects[points.per]} · ${points.scale.min} to ${points.scale.max} · steps of ${points.scale.step} from the minimum · starting score ${points.default}`
        : 'No scores',
    ],
    ['Reason for decision', writtenLabel(written.reason)],
    ['Feedback', writtenLabel(written.feedback)],
  ];
  return (
    <details className="rounded-lg border border-border p-4">
      <summary className="min-h-10 cursor-pointer font-strong">
        Current ballot definition · version {definition.revision}
      </summary>
      <div className="flex flex-col gap-4 pt-3">
        <dl className="flex flex-col gap-3">
          {lines.map(([label, value]) => (
            <div key={label}>
              <dt className="font-strong">{label}</dt>
              <dd className="text-sm text-ink-muted">{value}</dd>
            </div>
          ))}
        </dl>
        {points?.criteria.kind === 'grid'
          ? points.criteria.groups.map((group) => (
              <section key={group.id} className="flex flex-col gap-3">
                <h3 className="font-strong">{group.name}</h3>
                {group.categories.map((category) => (
                  <div key={category.id}>
                    <h4 className="font-strong">{category.name}</h4>
                    <p className="text-sm text-ink-muted">{category.rewards}</p>
                    <ol className="list-inside list-decimal text-sm text-ink-muted">
                      {category.anchors.map((anchor, index) => (
                        <li key={index}>{anchor}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </section>
            ))
          : null}
        {points?.weights ? (
          <section>
            <h3 className="font-strong">Speech weights</h3>
            <ul className="text-sm text-ink-muted">
              {Object.entries(points.weights).map(([key, weight]) => (
                <li key={key}>
                  {segments.find((segment) => segment.key === key)?.label ??
                    key}{' '}
                  · scale multiplier {weight}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </details>
  );
}
