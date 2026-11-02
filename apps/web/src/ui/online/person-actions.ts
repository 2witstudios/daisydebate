import type { FormAction } from '../form-action/form-action';
import type { ChallengeFormState } from '../../features/challenges/forms';
import type { FriendFormState } from '../../features/friends/forms';
import type { CreationFormState } from '../../features/messaging/forms/create-form';
import type { PersonActionState } from '../../features/presence/person-action';

/** Every server action the online list uses; `ui/` never imports from `app/`. */
export type PersonActions = {
  readonly friend: FormAction<FriendFormState>;
  readonly sendChallenge: FormAction<ChallengeFormState>;
  readonly acceptChallenge: FormAction<ChallengeFormState>;
  readonly endChallenge: FormAction<ChallengeFormState>;
  readonly message: FormAction<CreationFormState>;
  readonly report: FormAction<PersonActionState>;
  readonly block: FormAction<PersonActionState>;
};
