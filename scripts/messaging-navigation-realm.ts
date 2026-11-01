/** Dedicated subprocess edge: DOM globals never enter the unit runner's realm. */
import {
  createMessagingNavigationRealm,
  runMessagingNavigationProbe,
} from '../apps/web/src/ui/messaging/conversation-navigation.test-support';
const win = createMessagingNavigationRealm();
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLFormElement',
  'HTMLTextAreaElement',
  'Event',
  'MouseEvent',
  'FormData',
  'Node',
  'self',
  'location',
] as const) {
  Object.defineProperty(globalThis, key, {
    value: key === 'window' || key === 'self' ? win : win[key],
    configurable: true,
  });
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  configurable: true,
});
try {
  process.stdout.write(
    JSON.stringify(
      await runMessagingNavigationProbe(win, Bun.argv[2] ?? 'ordinary'),
    ),
  );
} finally {
  await win.happyDOM.close();
}
