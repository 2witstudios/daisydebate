import { ballotCategories } from '@daisy/protocol';
export const ballotFormFixture = () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    version: '1',
    commandId: 'c'.repeat(24),
    expectedVersion: '3',
    judgeParticipantId: 'j'.repeat(24),
    freezeRevision: '1',
    winner: 'affirmative',
    reason: 'The affirmative answered the decisive clash.',
  }))
    form.set(key, value);
  for (const side of ['affirmative', 'negative'])
    for (const category of ballotCategories)
      form.set(`${side}-${category}`, '3');
  return form;
};
