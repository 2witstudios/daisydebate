'use server';

import { reportResultSchema } from '@daisy/protocol';
import {
  reported,
  reportFormUnavailable,
  type ReportFormState,
} from '../../../features/reports/form';
import { processRoute } from '../../../server/process-app';
import { post, text } from '../form-post';

const routes = { report: processRoute((all) => all.reports.file) };

/** Reports a member, with a reason. */
export async function reportAction(
  _previous: ReportFormState,
  form: FormData,
): Promise<ReportFormState> {
  try {
    const response = await post(routes.report, '/api/reports', {
      version: 1,
      username: text(form, 'username'),
      reason: text(form, 'reason'),
      surface: text(form, 'surface'),
    });
    const result = reportResultSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    return result.success ? reported : reportFormUnavailable();
  } catch {
    return reportFormUnavailable();
  }
}
