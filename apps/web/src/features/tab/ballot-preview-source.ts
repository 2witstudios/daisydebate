import type { BallotDefinition } from '@daisy/protocol';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { field } from '../forms/form-state';
import { ballotBodyFromForm } from './ballot-body-form';

/**
 * Which definition a stored event's ballot preview draws, and why: the
 * event's saved one, a stored version the host has picked but not yet
 * selected, or the definition the publish form now describes. A draft the
 * form cannot yet make keeps the last one it could.
 */
export type BallotPreviewSource =
  | { readonly kind: 'saved' }
  | {
      readonly kind: 'version';
      readonly definition: BallotDefinition;
      readonly name: string;
      readonly version: number;
    }
  /** The host picked Daisy's ballot, which this read does not carry. */
  | { readonly kind: 'daisy-unshown' }
  /**
   * The definition the publish form now makes. `named` is false while a new
   * definition still lacks the name publishing needs.
   */
  | {
      readonly kind: 'draft';
      readonly definition: BallotDefinition;
      readonly named: boolean;
    }
  /** A publish form that cannot yet be published, and its last complete draft. */
  | {
      readonly kind: 'unfinished-draft';
      readonly lastComplete: BallotDefinition | null;
    };

export const savedPreview: BallotPreviewSource = { kind: 'saved' };

const savedDefinition = (view: EventBallotAuthoringView) =>
  view.definition?.ballot ?? null;

/** The definition the preview draws for a source. */
export const previewDefinition = (
  view: EventBallotAuthoringView,
  source: BallotPreviewSource,
): BallotDefinition | null => {
  switch (source.kind) {
    case 'version':
      return source.definition;
    case 'draft':
      return source.definition;
    case 'unfinished-draft':
      return source.lastComplete ?? savedDefinition(view);
    case 'saved':
    case 'daisy-unshown':
      return savedDefinition(view);
  }
};

/** What the preview says it is drawing. */
export const previewStatus = (
  view: EventBallotAuthoringView,
  source: BallotPreviewSource,
): string => {
  const saved = savedDefinition(view);
  const savedLine =
    saved === null
      ? 'The saved setting: no ballot.'
      : `The saved ballot, version ${saved.revision}.`;
  switch (source.kind) {
    case 'saved':
      return view.capabilities.publish || view.capabilities.pin
        ? `${savedLine} Changes you make here show before you save.`
        : savedLine;
    case 'version':
      return `${source.name}, version ${source.version}: not yet this event's ballot.`;
    case 'daisy-unshown':
      return `${savedLine} Daisy's ballot for this format shows once you use it.`;
    case 'draft':
      return source.named
        ? 'An unpublished draft. Judges get it only once it is published and selected.'
        : 'An unpublished draft. Name it to publish it; judges get it only once it is published and selected.';
    case 'unfinished-draft':
      return source.lastComplete === null
        ? `${savedLine} Finish the draft's fields to preview it.`
        : 'An unpublished draft, as it last stood complete. Finish its fields to preview the rest.';
  }
};

/** The source after the event-ballot picker changes to `value`. */
export const pickedPreview = (
  view: EventBallotAuthoringView,
  value: string,
): BallotPreviewSource => {
  const saved = view.definition?.source;
  // The picker's saved option is Daisy's where the event has no stored one.
  if (value === 'daisy')
    return saved === undefined || saved.kind === 'daisy'
      ? savedPreview
      : { kind: 'daisy-unshown' };
  if (saved?.kind === 'stored' && value === `${saved.id}@${saved.version}`)
    return savedPreview;
  for (const definition of view.definitions)
    for (const version of definition.versions)
      if (`${definition.id}@${version.version}` === value)
        return {
          kind: 'version',
          definition: version.definition,
          name: definition.name,
          version: version.version,
        };
  return savedPreview;
};

/**
 * The source after the publish form changes: the definition its fields now
 * make, or, while it cannot yet be published, the last draft that could (or
 * none). The same parser the publish action runs reads the form; a new
 * definition is also checked for the name that action requires.
 */
export const draftedPreview = (
  view: EventBallotAuthoringView,
  form: FormData,
  previous: BallotPreviewSource,
): BallotPreviewSource => {
  const unfinished: BallotPreviewSource = {
    kind: 'unfinished-draft',
    lastComplete:
      previous.kind === 'draft'
        ? previous.definition
        : previous.kind === 'unfinished-draft'
          ? previous.lastComplete
          : null,
  };
  try {
    const body = ballotBodyFromForm(form);
    const saved = savedDefinition(view);
    return {
      kind: 'draft',
      definition: {
        key: saved?.key ?? 'ballot-draft',
        revision: saved?.revision ?? 1,
        ...body,
      },
      named:
        field(form, 'publish-target') !== 'new' ||
        field(form, 'definition-name') !== '',
    };
  } catch {
    return unfinished;
  }
};
