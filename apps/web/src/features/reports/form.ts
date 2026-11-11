import {
  idle,
  refusedWith,
  type Idle,
  type Refused,
} from '../forms/form-state';

/** The report was filed, which lets the menu close. */
export type Reported = { readonly kind: 'reported' };

/** The report form's answer. */
export type ReportFormState = Idle | Refused | Reported;

export const initialReportForm: ReportFormState = idle();
export const reported: Reported = { kind: 'reported' };

const reportDoneNotice = 'Reported.';
const reportFailedNotice = 'Could not send that report. Try again.';

/** The answer when the report was not filed or the call never arrived. */
export const reportFormUnavailable = (): ReportFormState =>
  refusedWith({}, reportFailedNotice);

/**
 * What a report form renders: `notice` is what to say about the answer, and
 * `refusal` is that same notice only when the report was not filed, for a
 * surface that closes on success instead of confirming it.
 */
export type ReportFields = {
  readonly filed: boolean;
  readonly notice: string | undefined;
  readonly refusal: string | undefined;
};

export function reportFields(answer: ReportFormState): ReportFields {
  switch (answer.kind) {
    case 'idle':
      return { filed: false, notice: undefined, refusal: undefined };
    case 'refused':
      return { filed: false, notice: answer.error, refusal: answer.error };
    case 'reported':
      return { filed: true, notice: reportDoneNotice, refusal: undefined };
  }
}
