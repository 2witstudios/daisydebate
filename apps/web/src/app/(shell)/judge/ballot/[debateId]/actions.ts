'use server';

import { systemClock } from '@daisy/clock';
import { getDebateInfo } from '../../../../../features/debates/get-debate';
import {
  ballotDestination,
  parseBallot,
} from '../../../../../features/judge/ballot';
import { getBallotDebaters } from '../../../../../features/judge/get-ballots';
import type { MockFormState } from '../../../../../features/mock-form/form';
import { runMockForm } from '../../../../../server/mock-form-action';

/**
 * The ballot, as a server action: it works before hydration and without
 * JavaScript. `debateId` is bound from the page and comes back from the
 * browser, so an unknown debate goes to the Judge hub, never to a made-up
 * address.
 */
export async function submitBallotAction(
  debateId: unknown,
  _state: MockFormState,
  form: unknown,
): Promise<MockFormState> {
  const id = typeof debateId === 'string' ? debateId : '';
  const known = getDebateInfo(id, systemClock.now()) !== null;
  const debaters = getBallotDebaters(id);
  return runMockForm(
    form,
    (posted) => parseBallot(posted, debaters),
    () => (known ? ballotDestination(id) : '/judge'),
  );
}
