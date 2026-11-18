'use client';

import type { FormAction } from '../form-action/form-action';
import { Button } from '../components/button/button';
import { ClubForm } from './club-form';
import type { ClubFormState } from './club-form-state';

/** Accept the seat, or decline it: two buttons in one form, each naming its answer. */
export function InvitationAnswerForm({
  action,
}: {
  readonly action: FormAction<ClubFormState>;
}) {
  return (
    <ClubForm action={action} label="Answer the invitation">
      {({ pending }) => (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="answer" value="accept" disabled={pending}>
            Accept the seat
          </Button>
          <Button
            type="submit"
            name="answer"
            value="decline"
            variant="secondary"
            disabled={pending}
          >
            Decline
          </Button>
        </div>
      )}
    </ClubForm>
  );
}
