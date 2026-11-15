import { assert, setupRitewayBun, test } from 'riteway/bun';
import { postedForm } from '../../lib/testing/posted-form';
import {
  ballotBodyFromForm,
  publishBallotEnvelope,
  pinBallotEnvelope,
  screeningBallotEnvelope,
  type BallotAuthoringContext,
} from './ballot-authoring-form';
setupRitewayBun();
const context: BallotAuthoringContext = {
  lobbyId: 'l'.repeat(24),
  eventId: 'e'.repeat(24),
  commandId: 'c'.repeat(24),
  lobbyVersion: 7,
  settingsVersion: 3,
  eventName: 'Varsity',
  eventLabel: null,
  handle: 'actual-open',
};
const fields = {
  'publish-target': 'new',
  'definition-name': 'Authored custom ballot',
  decision: 'winner',
  'score-subject': 'speech',
  'score-min': '0.25',
  'score-max': '0.56',
  'score-step': '0.1',
  'score-default': '0.35',
  'criteria-kind': 'grid',
  'group-count': '1',
  'group-0-id': 'case',
  'group-0-name': 'The case',
  'group-0-count': '1',
  'group-0-criterion-0-id': 'reasoning',
  'group-0-criterion-0-name': 'Reasoning',
  'group-0-criterion-0-rewards': 'Supported comparison',
  'group-0-criterion-0-anchors': 'Unsupported\nSupported\nCompared',
  'weight-count': '1',
  'weight-0-key': 'reply',
  'weight-0-value': '0.5',
  'reason-rule': 'required',
  'reason-max': '900',
  'feedback-rule': 'off',
  'speaker-ranks': 'on',
};
const body = {
  decision: {
    kind: 'winner',
    lowPointWin: false,
    tie: false,
    doubleLoss: false,
  },
  points: {
    per: 'speech',
    scale: { min: 0.25, max: 0.56, step: 0.1 },
    default: 0.35,
    criteria: {
      kind: 'grid',
      groups: [
        {
          id: 'case',
          name: 'The case',
          categories: [
            {
              id: 'reasoning',
              name: 'Reasoning',
              rewards: 'Supported comparison',
              anchors: ['Unsupported', 'Supported', 'Compared'],
            },
          ],
        },
      ],
    },
    weights: { reply: 0.5 },
  },
  speakerRanks: true,
  written: { reason: { required: true, max: 900 }, feedback: null },
};
test('visible author fields post the exact canonical body with original guards', () => {
  const form = postedForm(fields);
  assert({
    given:
      'explicit authored keys, guidance, offset scale, default and speech weight',
    should:
      'publish only those values with the bound original lobby revision and server-owned immutable identity',
    actual: [ballotBodyFromForm(form), publishBallotEnvelope(context, form)],
    expected: [
      body,
      {
        version: 1,
        commandId: context.commandId,
        expected: { lobby: 7 },
        command: {
          type: 'define-ballot',
          lobbyId: context.lobbyId,
          ballotDefinition: { kind: 'new', name: 'Authored custom ballot' },
          settings: body,
        },
      },
    ],
  });
});
test('author forms reject incomplete, off-lattice or unsupported collection without inferred values', () => {
  const invalid = [
    { 'score-default': '' },
    { 'score-default': '0.3' },
    { privateNote: 'optional' },
    { 'group-0-criterion-0-anchors': '' },
    { 'weight-count': '2', 'weight-1-key': 'reply', 'weight-1-value': '1' },
    { decision: 'none' },
  ];
  const refuses = (change: Record<string, string>) => {
    try {
      ballotBodyFromForm(postedForm({ ...fields, ...change }));
      return false;
    } catch {
      return true;
    }
  };
  assert({
    given:
      'missing defaults, an invalid lattice value, private notes, missing guidance, duplicate speech weights or no valid decision',
    should: 'refuse every incomplete authoring attempt',
    actual: invalid.map(refuses),
    expected: invalid.map(() => true),
  });
});
test('pinning and screening remain separate guarded commands', () => {
  const id = 'b'.repeat(24);
  assert({
    given:
      'an exact stored version, an explicit Daisy selection and screening off',
    should:
      'retain the original guards without modifying or publishing a definition',
    actual: [
      pinBallotEnvelope(context, postedForm({ 'ballot-version': `${id}@2` })),
      pinBallotEnvelope(context, postedForm({ 'ballot-version': 'daisy' })),
      screeningBallotEnvelope(context, postedForm({ screening: 'off' })),
    ],
    expected: [
      {
        version: 1,
        commandId: context.commandId,
        expected: { lobby: 7 },
        command: {
          type: 'update-event',
          lobbyId: context.lobbyId,
          eventId: context.eventId,
          name: 'Varsity',
          label: null,
          ballotDefinition: { id, version: 2 },
        },
      },
      {
        version: 1,
        commandId: context.commandId,
        expected: { lobby: 7 },
        command: {
          type: 'update-event',
          lobbyId: context.lobbyId,
          eventId: context.eventId,
          name: 'Varsity',
          label: null,
          ballotDefinition: null,
        },
      },
      {
        version: 1,
        commandId: context.commandId,
        expected: { settings: 3 },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: context.eventId },
          key: 'ballot.screening',
          value: { value: 'off' },
          hold: 'default',
        },
      },
    ],
  });
});
