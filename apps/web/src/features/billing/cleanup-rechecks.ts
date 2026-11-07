import type { Database } from '@daisy/db';
type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  'rechecks' | 'reopen'
>;

/** Acknowledgement ends one scan, not future discovery; failures cannot pin the rest of this bounded page. */
export function createCleanupRechecks(input: {
  readonly store: Store;
  readonly failed: (error: unknown, stage: 'page' | 'reopen') => void;
}) {
  let pass: Parameters<Store['rechecks']>[0],
    stopped = false;
  return {
    async run() {
      if (stopped) return;
      let page: Awaited<ReturnType<Store['rechecks']>>;
      try {
        page = await input.store.rechecks(pass);
      } catch (error) {
        input.failed(error, 'page');
        return;
      }
      for (const { jobId } of page.rows) {
        if (stopped) return;
        try {
          await input.store.reopen(jobId);
        } catch (error) {
          input.failed(error, 'reopen');
        }
      }
      if (!stopped) pass = page.next ?? undefined;
    },
    stop() {
      stopped = true;
    },
  };
}
