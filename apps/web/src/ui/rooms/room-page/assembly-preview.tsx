import type { RoomView } from '@daisy/protocol';
import { formatDuration } from '../../../features/rooms/duration-input';
import { seatLabel } from './assembly-controls';

export function AssemblySchedule({ view }: { readonly view: RoomView }) {
  return (
    <section aria-labelledby="room-schedule-title" className="min-w-0">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="room-schedule-title"
          className="font-display text-xl font-semibold"
        >
          The round ahead
        </h2>
        <span className="text-xs text-ink-muted tabular-nums">
          {formatDuration(
            view.rules.segments.reduce(
              (sum, segment) => sum + segment.durationMs,
              0,
            ),
          )}{' '}
          scheduled time
        </span>
      </header>
      <ol
        aria-label="Saved speech order"
        className="grid room-schedule-grid divide-y divide-border border-y border-border"
      >
        {view.rules.segments.map((segment) => (
          <li
            key={segment.key}
            className="flex min-w-0 flex-col gap-2 border-r border-border px-3 py-4"
          >
            <span className="text-xs text-ink-muted">
              {seatLabel(segment.side, segment.slot)}
            </span>
            <strong className="text-sm font-semibold wrap-anywhere">
              {segment.label}
            </strong>
            <span className="text-lg tabular-nums">
              {formatDuration(segment.durationMs)}
            </span>
          </li>
        ))}
      </ol>
      <details className="mt-3 text-xs text-ink-muted">
        <summary className="cursor-pointer">
          Format definition · revision {view.formatVersion}
        </summary>
        <p className="mt-2 wrap-anywhere">
          {view.formatId} · revision {view.formatVersion}
          {view.presetVersion === null ? '' : ` · preset ${view.presetVersion}`}
        </p>
      </details>
    </section>
  );
}

export function AssemblySummary({ view }: { readonly view: RoomView }) {
  const config = view.config;
  const rows = [
    [
      'Speaking order',
      `${view.rules.segments.filter((s) => s.side === 'affirmative').length} affirmative, ${view.rules.segments.filter((s) => s.side === 'negative').length} negative`,
    ],
    [
      'Before the round',
      config.preRoundPrep.enabled
        ? formatDuration(config.preRoundPrep.durationMs)
        : 'Off',
    ],
    [
      'Preparation per side',
      config.inRoundPrep.enabled
        ? formatDuration(config.inRoundPrep.budgetMsPerSide)
        : 'Off',
    ],
    ['Countdown', formatDuration(config.speechTiming.countdownMs)],
    ['Questions', config.crossExamination.crossExMode.replaceAll('_', ' ')],
    ['Interruptions', config.interruptions?.mode.replaceAll('_', ' ') ?? 'Off'],
    ...(config.interruptions
      ? [
          [
            'Minimum remaining',
            formatDuration(config.interruptions.minRemainingMs),
          ],
        ]
      : []),
    ['Yielding', config.yielding?.allowed ? 'Allowed' : 'Off'],
    ['Return unused time', config.yielding?.returnsTime ? 'Yes' : 'No'],
  ];
  return (
    <dl
      aria-label="Saved round settings"
      className="flex flex-col gap-3 text-sm"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="min-w-0 text-right wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
