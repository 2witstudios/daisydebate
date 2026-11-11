import { assert, setupRitewayBun, test } from 'riteway/bun';
import { everyMemberOf } from './every-member';
import { recordingJobStatuses } from './recording-processing';
import { recordingLifecycleSchema, recordingStatuses } from './recording';
import { recordingJobStateSchema } from './recording-processing';

setupRitewayBun();

type Side = 'left' | 'right';

test('a list of every member is tied to its union both ways', () => {
  assert({
    given: 'a list naming both members of a union',
    should: 'be that list, unchanged',
    actual: everyMemberOf<Side>()(['left', 'right']),
    expected: ['left', 'right'],
  });
  // @ts-expect-error a member the list leaves out does not compile
  everyMemberOf<Side>()(['left']);
  // @ts-expect-error an entry outside the union does not compile
  everyMemberOf<Side>()(['left', 'right', 'up']);
});

test('the stored status vocabularies are their lifecycles', () => {
  const statusesOf = (schema: {
    readonly options: readonly {
      readonly shape: { readonly status: { readonly value: string } };
    }[];
  }) => schema.options.map((option) => option.shape.status.value);
  assert({
    given: 'the Recording and the Recording job status lists',
    should: 'name exactly the statuses their lifecycle schemas hold, in order',
    actual: [[...recordingStatuses], [...recordingJobStatuses]],
    expected: [
      statusesOf(recordingLifecycleSchema),
      statusesOf(recordingJobStateSchema),
    ],
  });
});
