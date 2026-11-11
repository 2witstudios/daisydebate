import { assert, setupRitewayBun, test } from 'riteway/bun';
import { done } from './form-state';
import {
  initialSaveForm,
  saveNotice,
  saveRefused,
  type SaveFormState,
} from './save-form';

setupRitewayBun();

test('a settings save answers exactly one of nothing yet, a refusal, or saved', () => {
  const form = new FormData();
  form.set('showPolicy', 'on');
  const answers: readonly SaveFormState[] = [
    initialSaveForm,
    saveRefused(form),
    done(),
  ];
  assert({
    given: 'each answer a save-in-place form can hold',
    should: 'name its kind and say what the form shows beside Save',
    actual: answers.map((answer) => [answer.kind, saveNotice(answer)]),
    expected: [
      ['idle', undefined],
      ['refused', 'Could not save. Try again.'],
      ['done', 'Saved.'],
    ],
  });
  assert({
    given: 'a refused save',
    should: 'keep the choices that were posted',
    actual: saveRefused(form).values,
    expected: { showPolicy: 'on' },
  });
});
