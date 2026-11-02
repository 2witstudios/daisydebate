/** The report form's answer. `done` lets the menu close. */
export type ReportFormState = {
  readonly done?: boolean;
  readonly notice?: string;
};

export const reportDoneNotice = 'Reported.';
export const reportFailedNotice = 'Could not send that report. Try again.';
