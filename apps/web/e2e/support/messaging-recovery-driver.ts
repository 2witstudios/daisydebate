import type { Page, TestInfo } from '@playwright/test';
import { callLaunchControl } from './room-launch-settled';
import { messagingRecoveryControlPath } from './messaging-recovery-control';
import {
  watchConversationRecovery,
  messagingAdmissionEvidence,
} from './messaging-recovery-evidence';
export const control = (
  operation:
    | 'refuse-messaging-history'
    | 'refuse-messaging-entry'
    | 'allow-messaging-reads',
) =>
  callLaunchControl(
    messagingRecoveryControlPath(Number(process.env.E2E_PORT)),
    operation,
  );
export const composer = (page: Page) =>
  page.getByRole('textbox', { name: 'Your message', exact: true });
export const refused = (page: Page) =>
  page.getByText('This conversation could not load.', { exact: true });
export async function evidence(
  info: TestInfo,
  observer: ReturnType<typeof watchConversationRecovery>,
) {
  const admission = await messagingAdmissionEvidence(observer.phases());
  await info.attach('messaging-recovery-safe-evidence', {
    contentType: 'application/json',
    body: JSON.stringify({ route: observer.snapshot(), ...admission }, null, 2),
  });
  return admission;
}
