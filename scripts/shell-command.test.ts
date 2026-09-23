import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseShell } from './shell-command';

setupRitewayBun();

const words = (command: string) =>
  parseShell(command).map((segment) => segment.words);

describe('parseShell', () => {
  test('splits command lists and pipelines into simple commands', () => {
    assert({
      given: 'commands joined by &&, ||, ;, | and a newline',
      should: 'return one word list per simple command',
      actual: words('cd /a && git push || echo no; ps | grep x\nls'),
      expected: [
        ['cd', '/a'],
        ['git', 'push'],
        ['echo', 'no'],
        ['ps'],
        ['grep', 'x'],
        ['ls'],
      ],
    });
  });

  test('keeps quoted operators inside one word', () => {
    assert({
      given: 'single, double and escaped quoting around operators',
      should: 'unquote the words without splitting on the quoted operators',
      actual: words(`echo 'a && b' "c; d" e\\|f`),
      expected: [['echo', 'a && b', 'c; d', 'e|f']],
    });
  });

  test('extracts command substitutions as nested commands', () => {
    const [outer, inner, backtick] = parseShell(
      'kill $(pgrep -f server) `pgrep node`',
    );
    assert({
      given: 'a $(...) and a backtick substitution',
      should:
        'mark the words as substituted and parse each body as its own command',
      actual: [outer.words[0], outer.dynamic, inner.words, backtick.words],
      expected: ['kill', true, ['pgrep', '-f', 'server'], ['pgrep', 'node']],
    });
  });

  test('records redirection targets and drops fd duplication', () => {
    const [segment] = parseShell('echo x > .claude/state.md 2>&1 >>log');
    assert({
      given: 'output redirections and an fd duplication',
      should: 'keep only the file targets',
      actual: [segment.words, segment.redirects],
      expected: [
        ['echo', 'x'],
        ['.claude/state.md', 'log'],
      ],
    });
  });

  test('treats heredoc bodies as data, not commands', () => {
    assert({
      given: 'a heredoc whose body looks like a dangerous command',
      should: 'not parse the body as a command',
      actual: words("cat > f <<'EOF'\npkill -f node\nEOF\nls"),
      expected: [['cat'], ['ls']],
    });
  });

  test('splits leading environment assignments from the command', () => {
    const [segment] = parseShell('A=1 B="two words" git push');
    assert({
      given: 'prefix assignments before a command',
      should: 'separate the assignments from the words',
      actual: [segment.assignments, segment.words],
      expected: [{ A: '1', B: 'two words' }, ['git', 'push']],
    });
  });
});
