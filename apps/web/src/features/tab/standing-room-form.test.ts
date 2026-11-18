import { formFields } from '../forms/form-state';
import { plainRoomConfig } from '@daisy/protocol/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  standingRoomEnvelope,
  standingRoomAnswer,
  standingRoomUnavailable,
  initialStandingRoom,
  standingRoomContext,
} from './standing-room-form';
setupRitewayBun();
test('standing Room form freezes read pins and configuration across replay', () => {
  const context = {
    commandId: createId(),
    lobbyId: createId(),
    templateId: createId(),
    config: plainRoomConfig,
    selection: {
      kind: 'catalog' as const,
      formatId: 'freestyle',
      formatVersion: 3,
      presetVersion: 7,
      competitionType: 'casual' as const,
    },
    recording: { value: 'off' as const, locked: false },
    visibility: { value: 'unlisted' as const, locked: true },
    resolutionChoicePolicy: { method: 'fixed' as const, ownText: true },
  };
  const form = new FormData();
  form.set('title', 'Native league Room');
  form.set('visibility', 'unlisted');
  form.set('recording', 'off');
  form.set('resolution', 'custom');
  form.set('topic', 'Public libraries should receive more funding.');
  const answer = standingRoomEnvelope(context, form);
  assert({
    given:
      'the selected offered template, frozen catalogue pin and displayed configuration',
    should:
      'submit the canonical command with the same nested and outer command id on retry',
    actual: [
      answer.commandId,
      answer.expected,
      answer.command.room.commandId,
      answer.command.room.selection,
      standingRoomEnvelope(context, form),
    ],
    expected: [
      context.commandId,
      {},
      context.commandId,
      context.selection,
      answer,
    ],
  });
  form.set('visibility', 'public');
  let rejected = false;
  try {
    standingRoomEnvelope(context, form);
  } catch {
    rejected = true;
  }
  assert({
    given: 'a tampered enforced visibility field',
    should: 'refuse the changed value',
    actual: rejected,
    expected: true,
  });
  assert({
    given: 'an unreadable answer after creation',
    should: 'retain uncertainty rather than minting another command',
    actual: standingRoomAnswer(form, {}).kind,
    expected: 'unacknowledged',
  });
});

test('standing Room form submits a named pool source and preserves refused values', () => {
  const poolId = createId();
  const context = {
    commandId: createId(),
    lobbyId: createId(),
    templateId: createId(),
    config: plainRoomConfig,
    selection: {
      kind: 'catalog' as const,
      formatId: 'freestyle',
      formatVersion: 1,
      presetVersion: 1,
      competitionType: 'casual' as const,
    },
    recording: { value: 'off' as const, locked: false },
    visibility: { value: 'public' as const, locked: false },
    resolutionChoicePolicy: { method: 'fixed' as const, ownText: false },
  };
  const form = new FormData();
  form.set('title', 'Pool Room');
  form.set('visibility', 'public');
  form.set('recording', 'off');
  form.set('resolution', poolId);
  form.set('topic', 'The actual offered wording.');
  const envelope = standingRoomEnvelope(context, form);
  assert({
    given: 'a named league pool choice',
    should: 'carry its actual id/text and displayed config',
    actual: [
      envelope.command.poolResolutionId,
      envelope.command.room.resolution,
      envelope.command.config,
    ],
    expected: [
      poolId,
      { kind: 'custom', text: 'The actual offered wording.' },
      plainRoomConfig,
    ],
  });
  const refused = standingRoomAnswer(form, {
    kind: 'refused',
    refusal: 'setting-enforced',
  });
  assert({
    given: 'a current settings refusal',
    should: 'retain submitted values for review',
    actual: 'values' in refused ? refused.values : null,
    expected: {
      title: 'Pool Room',
      visibility: 'public',
      recording: 'off',
      resolution: poolId,
      topic: 'The actual offered wording.',
    },
  });
});

test('standing Room recording honors its resolved lock and frozen retry', () => {
  const creation = {
    selection: {
      kind: 'catalog' as const,
      formatId: 'freestyle',
      formatVersion: 1,
      presetVersion: 1,
      competitionType: 'casual' as const,
    },
    config: plainRoomConfig,
    visibility: { value: 'public' as const, locked: false },
    recording: { value: 'on' as const, locked: true },
    rating: { kind: 'unrated' as const },
    resolutionChoicePolicy: {
      method: 'fixed' as const,
      ownText: true,
      choices: [],
    },
  };
  const context = standingRoomContext({
    commandId: createId(),
    lobbyId: createId(),
    templateId: createId(),
    creation,
  });
  const form = new FormData();
  form.set('title', 'Recorded Room');
  form.set('visibility', 'public');
  form.set('recording', 'on');
  form.set('resolution', 'custom');
  form.set('topic', 'The actual submitted wording.');
  const command = standingRoomEnvelope(context, form);
  const lost = standingRoomUnavailable(form);
  const retry = new FormData();
  if (lost.kind === 'unacknowledged')
    for (const [name, value] of Object.entries(lost.values))
      retry.set(name, value);
  assert({
    given: 'resolved enforced recording on and a lost response',
    should: 'prefill on and retry the exact command with officials recording',
    actual: [
      formFields(initialStandingRoom(creation)).values['recording'],
      command.command.room.recordingPolicy,
      standingRoomEnvelope(context, retry),
    ],
    expected: ['on', 'officials', command],
  });
  form.set('recording', 'off');
  let rejected = false;
  try {
    standingRoomEnvelope(context, form);
  } catch {
    rejected = true;
  }
  assert({
    given: 'a changed enforced recording field',
    should: 'refuse the mismatch',
    actual: rejected,
    expected: true,
  });
  const editable = {
    ...context,
    recording: { value: 'on' as const, locked: false },
  };
  assert({
    given: 'editable recording changed to off',
    should: 'send canonical off without changing frozen pins',
    actual: standingRoomEnvelope(editable, form).command.room.recordingPolicy,
    expected: 'off',
  });
});
