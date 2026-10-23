import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertTransactionStatement } from './transaction-statement';
import {
  forbiddenConfiguration,
  literalConfiguration,
} from './transaction-statement.test-support';

setupRitewayBun();

const accepted = (text: string) => {
  try {
    assertTransactionStatement(text, (message) => {
      throw new Error(message);
    });
    return true;
  } catch {
    return false;
  }
};

test('ordinary DML statements are admitted', () => {
  const statements = [
    'select 1',
    'SELECT id FROM rounds',
    'with x as (select 1) select * from x',
    'insert into rounds(id) values($1)',
    'update rounds set version=version+1',
    'delete from rounds where id=$1',
    'values (1),(2)',
    'show statement_timeout',
    'explain select 1',
    '/* leading /* nested */ comment */ select 1',
    '-- leading line comment\nselect 1',
    '\n\t  select 1',
  ];
  assert({
    given: 'statements whose first token is an admitted DML or read verb',
    should: 'admit each one',
    actual: statements.filter((text) => !accepted(text)),
    expected: [],
  });
});

test('transaction controls and other leading verbs are refused', () => {
  const statements = [
    '',
    '   ',
    '-- only a comment',
    'begin',
    'commit',
    'rollback',
    'savepoint s1',
    'set statement_timeout = 0',
    'set local lock_timeout to 0',
    'reset all',
    'copy rounds to stdout',
    'listen channel',
    "'select' as text",
    '$$select$$',
  ];
  assert({
    given: 'controls, configuration commands or a non-verb first token',
    should: 'refuse each one',
    actual: statements.filter(accepted),
    expected: [],
  });
});

test('configuration functions and settings views are refused in every lexical form', () => {
  assert({
    given:
      'set_config or pg_settings behind comments, quoting, schemas or literals',
    should: 'refuse each statement',
    actual: forbiddenConfiguration.filter(accepted),
    expected: [],
  });
});

test('configuration-looking words inside literals stay data', () => {
  assert({
    given:
      'standard, doubled-quote, dollar-quoted, escape and continued string literals',
    should: 'admit the statement without reading a configuration token',
    actual: literalConfiguration
      .map(([expression]) => `SELECT ${expression} as value`)
      .filter((text) => !accepted(text)),
    expected: [],
  });
});

test('identifier case and quoting follow PostgreSQL folding', () => {
  assert({
    given:
      'an upper-case bare name, a quoted name with a doubled quote and a mixed-case quoted name',
    should:
      'fold bare names, decode doubled quotes and compare quoted names case-insensitively to fail closed',
    actual: [
      accepted('select SET_CONFIG(1)'),
      accepted('select "set_config""x"(1)'),
      accepted('select "Set_Config"(1)'),
    ],
    expected: [false, true, false],
  });
});

test('a standard string after an escape string is not escape-processed without a newline', () => {
  assert({
    given:
      "an E'' literal followed on the same line by a standard literal ending in a backslash",
    should:
      'end the standard literal at its quote, while a newline continuation keeps escape processing',
    actual: [
      accepted("select E'a' 'b\\', set_config('x','0',true)"),
      accepted("select E'a'\n'b\\', set_config(1)'"),
    ],
    expected: [false, true],
  });
});

test('unterminated constructs consume the rest of the statement', () => {
  assert({
    given: 'an unterminated comment, string or dollar quote',
    should: 'treat the remainder as that construct, never as a token',
    actual: [
      accepted('select 1 /* set_config('),
      accepted("select 'set_config("),
      accepted('select $tag$ set_config('),
    ],
    expected: [true, true, true],
  });
});

test('the refusal carries the adapter ownership message', () => {
  const messages: string[] = [];
  try {
    assertTransactionStatement('begin', (message) => {
      messages.push(message);
      throw new Error(message);
    });
  } catch {
    // Recorded above.
  }
  assert({
    given: 'a refused transaction control',
    should: 'report that configuration and controls are adapter-owned',
    actual: messages,
    expected: ['Transaction controls and configuration are adapter-owned'],
  });
});
