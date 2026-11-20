import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  javascriptRequiredIssues,
  searchPrimitives,
} from './javascript-required';

setupRitewayBun();

const page = 'apps/web/src/ui/probe/probe.tsx';
const count = (source: string, path = page) =>
  javascriptRequiredIssues(path, source).length;

describe('a form before hydration (ADR 0114)', () => {
  test('rejects a form that names nowhere to submit', () => {
    assert({
      given: 'a form with no action, and one whose action only a spread passes',
      should: 'report each, since either submits as a native GET',
      actual: count(
        'const a = <form><input name="q" /></form>; const b = <form {...props} />;',
      ),
      expected: 2,
    });
  });

  test('rejects a GET form outside the search primitives', () => {
    assert({
      given: 'method get, in any case and quoting',
      should: 'report each',
      actual: count(
        'const a = <form method="get" action="/x" />; const b = <form method={"GET"} action="/x" />;',
      ),
      expected: 2,
    });
  });

  test('accepts a GET form in each search primitive', () => {
    assert({
      given: 'method get with an action in a primitive module',
      should: 'report nothing',
      actual: searchPrimitives.map((path) =>
        count('const a = <form method="get" action={props.action} />;', path),
      ),
      expected: searchPrimitives.map(() => 0),
    });
  });

  test('rejects a URL action with no method', () => {
    assert({
      given: 'a string and a template action with no method',
      should: 'report each, since the browser defaults to GET',
      actual: count(
        'const a = <form action="/api/x" />; const b = <form action={`/api/${id}`} />;',
      ),
      expected: 2,
    });
  });

  test('accepts a React action, a POST and a dialog', () => {
    assert({
      given: 'an action function, a URL with method post, and method dialog',
      should: 'report nothing',
      actual: count(
        'const a = <form action={post} />; const b = <form action="/api/x" method="post" />; const c = <form method="dialog" />;',
      ),
      expected: 0,
    });
  });
});

describe('nothing for JavaScript being off (ADR 0114)', () => {
  test('rejects a noscript fallback and a meta refresh', () => {
    assert({
      given: 'a noscript element and a refresh in each attribute spelling',
      should: 'report each',
      actual: count(
        'const a = <noscript><meta httpEquiv="refresh" content="3" /></noscript>; const b = <meta http-equiv="Refresh" content="3" />;',
      ),
      expected: 3,
    });
  });

  test('rejects a browser context with scripts off, however it is written', () => {
    assert({
      given:
        'identifier, shorthand, quoted and computed context options alongside plain text',
      should: 'report the four options',
      actual: count(
        "browser.newContext({ javaScriptEnabled: false }); test.use({ javaScriptEnabled }); test.use({ 'javaScriptEnabled': true }); test.use({ ['javaScriptEnabled']: false }); const note = 'javaScriptEnabled';",
        'apps/web/e2e/probe.e2e.ts',
      ),
      expected: 4,
    });
  });

  test('accepts other meta tags and files that are not source', () => {
    assert({
      given: 'a description meta and a markdown file naming noscript',
      should: 'report nothing',
      actual: [
        count('const a = <meta name="description" content="Daisy" />;'),
        count('<noscript>', 'docs/notes.md'),
      ],
      expected: [0, 0],
    });
  });
});
