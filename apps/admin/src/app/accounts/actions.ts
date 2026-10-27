'use server';

import { idSchema } from '@daisy/protocol';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  reconcileOpenCommands,
  submitBetaAccess,
} from '../../features/accounts/commands';
import { accessTabs, accountsHref } from '../../features/accounts/view';
import { currentOperator, requireSameOrigin } from '../../server/operator-gate';
import { adminRuntime } from '../../server/runtime';

/**
 * The accounts screen's plain POST forms (no client script). Each checks
 * the origin, then the live session; the command operation authorizes the
 * operator row again before anything is signed. The redirect carries only
 * a closed notice, so a reload never repeats the action.
 */
const commandForm = z.strictObject({
  userId: idSchema,
  state: z.enum(['approved', 'revoked']),
  expectedRevision: z.coerce.number().int().positive(),
  access: z.enum(accessTabs),
});

async function signedIn() {
  await requireSameOrigin();
  const operator = await currentOperator();
  if (!operator) redirect('/sign-in');
  return operator;
}

export async function setBetaAccessAction(form: FormData): Promise<never> {
  const operator = await signedIn();
  const fields = commandForm.safeParse(
    Object.fromEntries(
      ['userId', 'state', 'expectedRevision', 'access'].map((name) => [
        name,
        form.get(name),
      ]),
    ),
  );
  const { commands } = adminRuntime();
  if (!fields.success || !commands)
    redirect(
      accountsHref({
        access: 'pending',
        notice: commands ? 'refused' : 'unconfigured',
      }),
    );
  const view = await submitBetaAccess(commands, {
    operatorId: operator.id,
    targetUserId: fields.data.userId,
    desiredState: fields.data.state,
    expectedRevision: fields.data.expectedRevision,
  });
  redirect(
    accountsHref({
      access: fields.data.access,
      notice: view.notice,
      mail: 'mail' in view ? view.mail : null,
    }),
  );
}

export async function reconcileAction(form: FormData): Promise<never> {
  const operator = await signedIn();
  const back = form.get('back') === 'audit' ? '/audit' : null;
  const { commands } = adminRuntime();
  if (commands) await reconcileOpenCommands(commands, operator.id);
  redirect(
    back ??
      accountsHref({
        access: 'pending',
        notice: commands ? 'reconciled' : 'unconfigured',
      }),
  );
}
