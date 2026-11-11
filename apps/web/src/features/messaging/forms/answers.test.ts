import { assert, setupRitewayBun, test } from 'riteway/bun';
import { moved } from '../../forms/form-state';
import { nativeFileResponse } from '../files/form-response';
import {
  creationFields,
  creationFormUnavailable,
  creationIdle,
} from './create-form';
import {
  dmDecisionFields,
  dmDecisionIdle,
  dmDecisionUnavailable,
} from './decide-form';
import {
  fileFields,
  fileFormIdle,
  fileFormUnavailable,
  fileStranded,
  isFileFormState,
} from './file-form';
import {
  groupManagementFields,
  groupManagementIdle,
  groupManagementUnavailable,
} from './group-management-form';
import {
  messageMutationConflict,
  messageMutationUnavailable,
} from './message-mutation-form';
import {
  preferenceFields,
  preferenceFormState,
  preferenceSaved,
  preferenceSelections,
  preferenceUnavailable,
} from './preference-form';
import {
  reactionFields,
  reactionIdle,
  reactionUnavailable,
} from './reaction-form';
import {
  messageFields,
  messageFormUnavailable,
  messageIdle,
} from './send-form';

setupRitewayBun();
const requestId = 'r'.repeat(24);
const posted = () => {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    requestId,
    text: 'A draft',
    recipients: 'ada',
    title: 'Group',
    introduction: 'Hello',
    memberUsername: 'bea',
    following: 'yes',
    hidden: 'no',
    notificationLevel: 'all',
  }))
    form.set(name, value);
  form.set('file', new File(['x'], 'notes.pdf'));
  return form;
};
const keys = (answer: object) => Object.keys(answer).sort();

test('a messaging form that was not accepted answers refused and nothing else', () => {
  const refusals = [
    messageFormUnavailable(posted()),
    messageMutationUnavailable(posted()),
    messageMutationConflict(posted(), 'n'.repeat(24)),
    fileFormUnavailable(posted()),
    creationFormUnavailable(posted()),
    groupManagementUnavailable(posted()),
    dmDecisionUnavailable(posted()),
    preferenceUnavailable(posted()),
    reactionUnavailable(posted()),
  ];
  assert({
    given: 'each messaging form answering a post it could not accept',
    should:
      'be a refusal holding its values and its notice, with no destination',
    actual: refusals.map((answer) => [answer.kind, keys(answer)]),
    expected: refusals.map(() => ['refused', ['error', 'kind', 'values']]),
  });
});

test('a messaging form starts idle with the values it was given', () => {
  assert({
    given: 'each messaging form before anything is posted',
    should: 'be idle and say nothing',
    actual: [
      messageFields(messageIdle(requestId, 'Seed')),
      fileFields(fileFormIdle(requestId)),
      creationFields(creationIdle(requestId, 'ada')),
      groupManagementFields(groupManagementIdle(requestId)),
      dmDecisionFields(dmDecisionIdle(requestId)),
      preferenceFields(preferenceFormState(null)),
      reactionFields(reactionIdle(requestId)),
    ],
    expected: [
      { text: 'Seed', requestId, notice: undefined },
      { requestId, filename: '', notice: undefined, held: undefined },
      {
        requestId,
        recipients: 'ada',
        title: '',
        introduction: '',
        notice: undefined,
      },
      { requestId, memberUsername: '', notice: undefined },
      { requestId, notice: undefined },
      {
        following: '',
        hidden: '',
        notificationLevel: '',
        notice: undefined,
        next: undefined,
      },
      { requestId, notice: undefined },
    ],
  });
});

test('a refused messaging form renders its draft beside its notice', () => {
  assert({
    given: 'a refused message, creation and preference form',
    should: 'show again exactly what was posted, and why it was not taken',
    actual: [
      messageFields(messageFormUnavailable(posted())),
      creationFields(creationFormUnavailable(posted())).recipients,
      preferenceFields(preferenceUnavailable(posted())).following,
      fileFields(fileFormUnavailable(posted())).filename,
    ],
    expected: [
      {
        text: 'A draft',
        requestId,
        notice: 'Message could not be sent. Your draft is kept; try again.',
      },
      'ada',
      'yes',
      'notes.pdf',
    ],
  });
});

test('a messaging form that moved on holds no draft and no notice', () => {
  const answer = moved('/messages/channel');
  assert({
    given: 'an accepted post that leads elsewhere',
    should: 'render nothing to send again',
    actual: [
      messageFields(answer),
      creationFields(answer).notice,
      groupManagementFields(answer).notice,
      dmDecisionFields(answer).notice,
      reactionFields(answer).notice,
      fileFields(answer).held,
    ],
    expected: [
      { text: '', requestId: '', notice: undefined },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ],
  });
});

test('saved preferences stay on their page showing what is stored', () => {
  const stored = preferenceSelections({
    following: true,
    hidden: false,
    notificationLevel: 'mentions',
    readSequence: 3,
  });
  assert({
    given: 'a save the server acknowledged',
    should:
      'hold the stored selections and the page to return to, with no notice',
    actual: preferenceFields(
      preferenceSaved(stored, '/messages/c/preferences'),
    ),
    expected: {
      following: 'yes',
      hidden: 'no',
      notificationLevel: 'mentions',
      notice: undefined,
      next: '/messages/c/preferences',
    },
  });
});

test('an attachment answer is refused, stranded or moved, never two of them', async () => {
  const refused = fileFormUnavailable(posted());
  const stranded = fileStranded(refused, {
    fileId: 'f'.repeat(24),
    generation: 2,
  });
  const pages = await Promise.all(
    [refused, stranded, moved('/messages/channel')].map(async (answer) => {
      const response = nativeFileResponse(
        'c'.repeat(24),
        'm'.repeat(24),
        answer,
      );
      const html = await response.text();
      return [
        answer.kind,
        response.status,
        response.headers.get('location'),
        html.includes('Could not attach the file. Choose it again to retry.'),
        html.includes('Discard pending upload'),
      ];
    }),
  );
  assert({
    given: 'each answer a native attachment post can get',
    should:
      'show the refusal, offer the discard only when an upload is held, and redirect only when attached',
    actual: pages,
    expected: [
      ['refused', 200, null, true, false],
      ['stranded', 200, null, true, true],
      ['moved', 303, '/messages/channel', false, false],
    ],
  });
  assert({
    given: 'route results that are and are not attachment answers',
    should: 'accept only a known kind',
    actual: [
      isFileFormState(refused),
      isFileFormState(stranded),
      isFileFormState({ kind: 'sent' }),
      isFileFormState({ requestId, filename: 'a.pdf' }),
      isFileFormState(null),
    ],
    expected: [true, true, false, false, false],
  });
});
