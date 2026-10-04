import { Suspense } from 'react';
import { SampleActionNotice } from '../../ui/components/sample-action/sample-action-notice';
import { AppShell } from '../../ui/layout/app-shell/app-shell';
import { UiStoreProvider } from '../../ui/store/store';
import { shellAccount } from '../../lib/shell-account';
import { requestIdentity } from '../../lib/request-session';

/**
 * The signed-in product shell: renders AppShell's landmarks once (header,
 * nav, topic banner, content column, presence dock) and resolves the account once per
 * request, so every route in this group inherits the chrome instead of each
 * page composing it for itself. The root layout above keeps only <html>,
 * theme and fonts. The sample-action banner sits above every page: a control
 * with no backend answers with it on the same page.
 */
export default async function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await requestIdentity();
  return (
    <UiStoreProvider>
      <AppShell account={shellAccount(identity)}>
        <Suspense fallback={null}>
          <SampleActionNotice />
        </Suspense>
        {children}
      </AppShell>
    </UiStoreProvider>
  );
}
