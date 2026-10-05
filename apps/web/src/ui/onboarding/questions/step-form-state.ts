/** What a questionnaire or Skip form's server action answers. */
export type StepFormState = {
  /** The save was refused or never arrived; the choices stay as they were. */
  readonly refused?: boolean;
  /** Where a hydrated page navigates once the save landed. */
  readonly next?: string;
};

export const initialStepForm: StepFormState = {};

/** A post whose call failed in transport. */
export const stepUnavailable = (): StepFormState => ({ refused: true });
