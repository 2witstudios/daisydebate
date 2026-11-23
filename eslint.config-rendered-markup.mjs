/**
 * A component test reads what it rendered by role and accessible name
 * (RECON-4.8), never by matching tags, attributes or class strings in the
 * HTML. Test code under `apps/web/src` therefore never holds rendered HTML
 * as a string: it does not reach `react-dom/server` or `react-dom/static`
 * (by import, re-export, `import()`, `require`, a resolver or a mock: any
 * string naming the module), does not read an element's `innerHTML` or
 * `outerHTML` (by property, computed key or any string naming them), and
 * does not serialize a node (`getHTML`, `XMLSerializer`).
 *
 * The one home for rendered output is `apps/web/src/test-support/rendered/`:
 * `accessible.ts` answers roles, names and text, and `markup.ts` hands raw
 * HTML only to the markup contracts under `apps/web/src/markup-contracts/`,
 * the tests whose subject is the markup itself. Tab's screens and their feature
 * (`ui/tab/`, `features/tab/`) belong to the Tab team and are outside this
 * rule's scope. Setting up a DOM by writing `innerHTML` stays legal: the
 * test authored that markup.
 */
const message =
  'Read rendered output by role and name through apps/web/src/test-support/rendered/accessible (renderAccessible, accessible, accessibleWithin); a test whose subject is the markup itself lives under apps/web/src/markup-contracts/.';

const renderModule = /^react-dom\/(?:server|static)(?:[./]|$)/;
const markupModule = /(?:^|\/)test-support\/rendered\/markup(?:\.tsx?)?$/;
const serialized = new Set([
  'innerHTML',
  'outerHTML',
  'getHTML',
  'getInnerHTML',
  'XMLSerializer',
  'serializeToString',
]);

/**
 * A test that sets up its own DOM writes markup it authored (`el.innerHTML =
 * fixture`); only reading markup back is refused.
 */
function written(node) {
  const member = node.parent;
  return (
    member?.type === 'MemberExpression' &&
    member.property === node &&
    member.parent?.type === 'AssignmentExpression' &&
    member.parent.left === member
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Component tests read rendered output by role and name, never as HTML text.',
    },
    schema: [],
    messages: { roles: message },
  },
  create(context) {
    const report = (node) => {
      if (!written(node)) context.report({ node, messageId: 'roles' });
    };
    const names = (value) =>
      typeof value === 'string' &&
      (renderModule.test(value) ||
        markupModule.test(value) ||
        serialized.has(value));
    return {
      Literal(node) {
        if (names(node.value)) report(node);
      },
      TemplateLiteral(node) {
        if (node.quasis.some((quasi) => names(quasi.value.cooked)))
          report(node);
      },
      Identifier(node) {
        if (serialized.has(node.name)) report(node);
      },
    };
  },
};

export const renderedMarkupRules = {
  files: [
    'apps/web/src/**/*.test.{ts,tsx}',
    'apps/web/src/**/*.test-support.{ts,tsx}',
    'apps/web/src/**/test-support/**/*.{ts,tsx}',
  ],
  ignores: [
    'apps/web/src/test-support/rendered/**',
    'apps/web/src/markup-contracts/**',
    'apps/web/src/ui/tab/**',
    'apps/web/src/features/tab/**',
  ],
  plugins: { 'rendered-markup': { rules: { 'through-roles': rule } } },
  rules: { 'rendered-markup/through-roles': 'error' },
};
