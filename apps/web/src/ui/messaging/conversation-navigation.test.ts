import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

/** Each scenario boots its own realm: bounded and killed on expiry under load. */
const realmLimitMs = 25_000;
const sentReplace = 'replace:/messages/channel?sent=message';
const pending = true;
/** One command committed once; `commands` are the router effects it left. */
const oneSend = (commands: readonly string[], extra: object = {}) => ({
  pending,
  calls: 1,
  commits: 1,
  commands,
  ...extra,
});
const failedDraft = { requestId: 'request', text: 'Draft', ready: true };
const refused = { pending, calls: 1, commits: 0, commands: [], failedDraft };
const sameConversation = {
  pending,
  calls: 2,
  commits: 2,
  commands: [
    'intent:/messages/channel?before=2',
    'replace:/messages/channel?sent=new',
  ],
  nextCommand: { requestId: 'fresh', ready: true, text: '' },
  retainedNew: { requestId: 'fresh', ready: true, text: 'NEW' },
  submissions: [
    { requestId: 'request', text: 'Draft' },
    { requestId: 'fresh', text: 'NEW' },
  ],
};

const scenarios: Readonly<Record<string, object>> = {
  ordinary: oneSend([sentReplace]),
  edit: oneSend([
    'intent:/messages/channel/message?messageId=message&before=2',
  ]),
  preferences: oneSend(['intent:/messages/channel/preferences']),
  'same-conversation': sameConversation,
  'same-conversation-late': {
    ...sameConversation,
    awaitingFresh: { editable: false, ready: false },
  },
  'refreshed-draft': oneSend([sentReplace], {
    beforeDispatch: { text: 'Draft', requestId: 'request' },
  }),
  refusal: refused,
  // Earlier clicked during the send: its refusal keeps the draft, ID and member's page.
  'superseded-refusal': {
    ...refused,
    commands: ['intent:/messages/channel?before=2'],
  },
  transport: refused,
  'unknown-commit': {
    pending,
    calls: 2,
    commits: 1,
    commands: [sentReplace],
    failedDraft,
    submissions: [
      { requestId: 'request', text: 'Draft' },
      { requestId: 'request', text: 'Draft' },
    ],
  },
  disposed: oneSend([]),
  replaced: oneSend([]),
  'replaced-active': {
    pending,
    calls: 2,
    commits: 2,
    commands: ['replace:/messages/successor?sent=second'],
    commandsBeforeSuccessor: [],
  },
  modified: oneSend([sentReplace]),
  'new-tab': oneSend([sentReplace]),
  canceled: oneSend([sentReplace]),
  search: oneSend([]),
  'search-disposed': oneSend([]),
  'search-replaced': oneSend([]),
  'invalid-search': oneSend([sentReplace]),
};

for (const [scenario, expected] of Object.entries(scenarios)) {
  test(
    `actual composer completion ownership: ${scenario}`,
    async () => {
      const child = Bun.spawn(
        [
          'bun',
          `${import.meta.dir}/../../../scripts/messaging-navigation-realm.test-support.ts`,
          scenario,
        ],
        { stdout: 'pipe', stderr: 'pipe', timeout: realmLimitMs },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (code !== 0) throw new Error(`Mounted caller failed: ${stderr}`);
      assert({
        given: `${scenario} with a deferred actual composer action and StrictMode effect replay`,
        should:
          'respect the current local navigation owner without replaying completion or repeating committed work',
        actual: JSON.parse(stdout),
        expected,
      });
    },
    realmLimitMs + 5_000,
  );
}
