import { findBlockSources, type BlockSource } from '../cards/block-sources';
import {
  blockClock,
  latestVersion,
  speechTime,
  workingSpeeches,
  type Block,
  type Case,
  type Speech,
  type SpeechTime,
} from './case';
import { diffCases, type Diff } from './case-diff';
import { exportChoices, exportSettings, previewLines } from './case-export';
import {
  caseHref,
  views,
  type CaseQuery,
  type CaseViewTab,
  type ExportFormat,
  type ExportOption,
} from './case-query';

export type BlockRow = {
  readonly id: string;
  readonly index: number;
  readonly kind: Block['kind'];
  readonly title: string;
  readonly sub: string;
  readonly clock: string;
  readonly removed: boolean;
  readonly href: string | null;
};

type VersionRow = {
  readonly key: string;
  readonly tag: string;
  readonly title: string;
  readonly sub: string;
  readonly draft: boolean;
  readonly compareHref: string | null;
};

type CompareOption = { readonly value: string; readonly label: string };

type ExportChoice = {
  readonly id: ExportFormat;
  readonly label: string;
  readonly help: string;
  readonly href: string;
  readonly current: boolean;
};

type ExportSetting = {
  readonly id: ExportOption;
  readonly label: string;
  readonly help: string | null;
  readonly checked: boolean;
};

export type CaseView = {
  readonly case: Case;
  readonly query: CaseQuery;
  readonly tabs: readonly { id: CaseViewTab; label: string; href: string }[];
  readonly speechTabs: readonly {
    id: string;
    label: string;
    href: string;
    current: boolean;
    clock: string;
    over: boolean;
  }[];
  readonly speech: Speech;
  readonly speechTime: SpeechTime;
  readonly blocks: readonly BlockRow[];
  readonly hasRemovedCard: boolean;
  readonly sources: readonly BlockSource[];
  readonly versions: readonly VersionRow[];
  readonly nextVersion: number;
  readonly compare: {
    readonly fromOptions: readonly CompareOption[];
    readonly toOptions: readonly CompareOption[];
    readonly from: string;
    readonly to: string;
    readonly diff: Diff;
    /** The saved version the restore button would copy, or null. */
    readonly restoreVersion: number | null;
  };
  readonly export: {
    readonly choices: readonly ExportChoice[];
    readonly settings: readonly ExportSetting[];
    readonly preview: readonly string[];
  };
};

const snapshotOf = (c: Case, key: string): readonly Speech[] | undefined =>
  key === 'draft'
    ? c.draft?.speeches
    : c.versions.find((v) => String(v.version) === key)?.speeches;

const tabLabels: Readonly<Record<CaseViewTab, string>> = {
  compose: 'Compose',
  compare: 'Compare versions',
  export: 'Export and print',
};

/** The picker value a request names, or the fallback when it names nothing real. */
const pick = (
  options: readonly CompareOption[],
  asked: string,
  fallback: string,
): string => (options.some((o) => o.value === asked) ? asked : fallback);

function compareModel(c: Case, query: CaseQuery): CaseView['compare'] {
  const latest = latestVersion(c);
  const hasDraft = c.draft !== null;
  const fromOptions = c.versions.map((v) => ({
    value: String(v.version),
    label: `v${v.version} · ${v.when.toLowerCase()}`,
  }));
  const toOptions = hasDraft
    ? [
        { value: 'draft', label: `v${latest.version} · current (unsaved)` },
        ...fromOptions,
      ]
    : fromOptions;
  const from = pick(
    fromOptions,
    query.from,
    String(c.versions[1]?.version ?? latest.version),
  );
  const to = pick(
    toOptions,
    query.to,
    toOptions[0]?.value ?? String(latest.version),
  );
  return {
    fromOptions,
    toOptions,
    from,
    to,
    diff: diffCases(snapshotOf(c, from) ?? [], snapshotOf(c, to) ?? []),
    restoreVersion:
      from === String(latest.version) && !hasDraft ? null : Number(from),
  };
}

function versionRows(c: Case): readonly VersionRow[] {
  const latest = latestVersion(c);
  const draft = c.draft;
  const unsaved =
    draft === null ? null : diffCases(latest.speeches, draft.speeches);
  return [
    ...(draft === null || unsaved === null
      ? []
      : [
          {
            key: 'draft',
            tag: `v${latest.version}`,
            title: `Unsaved changes: ${unsaved.total}`,
            sub: draft.since,
            draft: true,
            compareHref: caseHref(c.id, {
              view: 'compare',
              from: String(latest.version),
              to: 'draft',
            }),
          },
        ]),
    ...c.versions.map((v) => ({
      key: String(v.version),
      tag: `v${v.version}`,
      title: v.note,
      sub: v.when,
      draft: false,
      compareHref: caseHref(c.id, {
        view: 'compare',
        from: String(v.version),
        ...(draft === null ? {} : { to: 'draft' }),
      }),
    })),
  ];
}

function speechTabs(
  c: Case,
  current: Speech,
  pace: number,
  limitSeconds: number,
) {
  return workingSpeeches(c).map((s) => {
    const time = speechTime(s, pace, limitSeconds);
    return {
      id: s.id,
      label: s.label,
      href: caseHref(c.id, { speech: s.id }),
      current: s.id === current.id,
      clock: time.clock,
      over: time.budget.over,
    };
  });
}

function blockRows(speech: Speech, pace: number): readonly BlockRow[] {
  return speech.blocks.map((b, index) => ({
    id: b.id,
    index: index + 1,
    kind: b.kind,
    title: b.title,
    sub: b.sub,
    clock: blockClock(b, pace),
    removed: b.removed === true,
    href: b.href ?? null,
  }));
}

function exportModel(
  c: Case,
  query: CaseQuery,
  current: Speech,
): CaseView['export'] {
  return {
    choices: exportChoices.map((choice) => ({
      ...choice,
      href: caseHref(c.id, { ...query, view: 'export', fmt: choice.id }),
      current: choice.id === query.fmt,
    })),
    settings: exportSettings.map((setting) => ({
      ...setting,
      checked: query.opts.includes(setting.id),
    })),
    preview: previewLines(query.fmt, query.opts, current),
  };
}

/** The case page's one driver: a case and the URL state to a view model. */
export function caseView(
  c: Case,
  query: CaseQuery,
  pace: number,
  limitSeconds: number,
  now: string,
): CaseView {
  const speeches = workingSpeeches(c);
  const current = speeches.find((s) => s.id === query.speech) ?? speeches[0];
  if (current === undefined) throw new Error(`case ${c.id} has no speech`);
  return {
    case: c,
    query,
    tabs: views.map((id) => ({
      id,
      label: tabLabels[id],
      href: caseHref(c.id, { view: id }),
    })),
    speechTabs: speechTabs(c, current, pace, limitSeconds),
    speech: current,
    speechTime: speechTime(current, pace, limitSeconds),
    blocks: blockRows(current, pace),
    hasRemovedCard: speeches.some((s) =>
      s.blocks.some((b) => b.removed === true),
    ),
    sources: findBlockSources(query.q, now, pace),
    versions: versionRows(c),
    nextVersion: latestVersion(c).version + 1,
    compare: compareModel(c, query),
    export: exportModel(c, query, current),
  };
}
