import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();

for (const [scenario, commands] of Object.entries({
  ordinary: ['replace:/messages/channel?sent=message'],
  edit: ['intent:/messages/channel/message?messageId=message&before=2'],
  preferences: ['intent:/messages/channel/preferences'],
  'same-conversation': [
    'intent:/messages/channel?before=2',
    'replace:/messages/channel?sent=new',
  ],
  'same-conversation-late': [
    'intent:/messages/channel?before=2',
    'replace:/messages/channel?sent=new',
  ],
  'refreshed-draft': ['replace:/messages/channel?sent=message'],
  refusal: [],
  transport: [],
  'unknown-commit': ['replace:/messages/channel?sent=message'],
  disposed: [],
  replaced: [],
  'replaced-active': ['replace:/messages/successor?sent=second'],
  modified: ['replace:/messages/channel?sent=message'],
  'new-tab': ['replace:/messages/channel?sent=message'],
  canceled: ['replace:/messages/channel?sent=message'],
  search: [],
  'search-disposed': [],
  'search-replaced': [],
  'canceled-search': ['replace:/messages/channel?sent=message'],
  'late-canceled-search': ['replace:/messages/channel?sent=message'],
  'invalid-search': ['replace:/messages/channel?sent=message'],
})) {
  test(`actual composer completion ownership: ${scenario}`, async () => {
    const child = Bun.spawn(
      [
        'bun',
        `${import.meta.dir}/../../../../../scripts/messaging-navigation-realm.ts`,
        scenario,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
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
      expected: {
        pending: true,
        calls:
          scenario === 'replaced-active' ||
          scenario === 'unknown-commit' ||
          scenario.startsWith('same-conversation')
            ? 2
            : 1,
        commits:
          scenario === 'refusal' || scenario === 'transport'
            ? 0
            : scenario === 'replaced-active' ||
                scenario.startsWith('same-conversation')
              ? 2
              : 1,
        commands,
        ...(scenario.startsWith('same-conversation')
          ? {
              nextCommand: { requestId: 'fresh', ready: true, text: '' },
              retainedNew: { requestId: 'fresh', ready: true, text: 'NEW' },
              submissions: [
                { requestId: 'request', text: 'Draft' },
                { requestId: 'fresh', text: 'NEW' },
              ],
            }
          : {}),
        ...(['refusal', 'transport', 'unknown-commit'].includes(scenario)
          ? {
              failedDraft: { requestId: 'request', text: 'Draft', ready: true },
              ...(scenario === 'unknown-commit'
                ? {
                    submissions: [
                      { requestId: 'request', text: 'Draft' },
                      { requestId: 'request', text: 'Draft' },
                    ],
                  }
                : {}),
            }
          : {}),
        ...(scenario === 'refreshed-draft'
          ? { beforeDispatch: { text: 'Draft', requestId: 'request' } }
          : {}),
        ...(scenario === 'replaced-active'
          ? { commandsBeforeSuccessor: [] }
          : {}),
      },
    });
  });
}
