'use server';

import { idSchema, reportOutcomes } from '@daisy/protocol';
import { moderationSuspensionMaxDays } from '@daisy/protocol/operator';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  liftRestriction,
  resolveReport,
} from '../../features/reports/commands';
import { currentOperator, requireSameOrigin } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';

/** The reports screen's plain POST forms; a redirect carries a closed notice. */
async function signedIn() {
  await requireSameOrigin();
  const operator = await currentOperator();
  if (!operator) redirect('/sign-in');
  return operator;
}

const suspensionDays = z.coerce
  .number()
  .int()
  .min(1)
  .max(moderationSuspensionMaxDays);

const resolveForm = z.strictObject({
  reportId: idSchema,
  subjectUserId: idSchema,
  outcome: z.enum(reportOutcomes),
  suspendDays: z.string(),
});

export async function resolveReportAction(form: FormData): Promise<never> {
  const operator = await signedIn();
  const { commands } = adminRuntime();
  const fields = resolveForm.safeParse({
    reportId: form.get('reportId'),
    subjectUserId: form.get('subjectUserId'),
    outcome: form.get('outcome'),
    suspendDays: String(form.get('suspendDays') ?? ''),
  });
  if (!fields.success || !commands) redirect('/reports?notice=refused');
  const { reportId, subjectUserId, outcome } = fields.data;
  // Only a suspension has a length: the field means nothing otherwise.
  const days = suspensionDays.safeParse(fields.data.suspendDays);
  const notice = await resolveReport(commands, {
    operatorId: operator.id,
    reportId,
    subjectUserId,
    resolution:
      outcome === 'suspended' && days.success
        ? { outcome, suspendDays: days.data }
        : outcome === 'suspended'
          ? redirect('/reports?notice=days')
          : { outcome },
  });
  redirect(`/reports?notice=${notice}`);
}

const liftForm = z.strictObject({ actionId: idSchema, userId: idSchema });

export async function liftRestrictionAction(form: FormData): Promise<never> {
  const operator = await signedIn();
  const { commands } = adminRuntime();
  const fields = liftForm.safeParse({
    actionId: form.get('actionId'),
    userId: form.get('userId'),
  });
  if (!fields.success || !commands) redirect('/reports?notice=refused');
  const notice = await liftRestriction(commands, {
    operatorId: operator.id,
    ...fields.data,
  });
  redirect(`/reports?notice=${notice}`);
}
