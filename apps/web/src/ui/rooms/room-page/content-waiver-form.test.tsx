import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CONTENT_WAIVER_VERSION } from '../../../features/legal/agreements';
import { findElements } from '../../test-support/find-elements';
import { ContentWaiverForm } from './content-waiver-form';

setupRitewayBun();

const tree = ContentWaiverForm({ action: async () => ({ values: {} }) });
const input = (name: string) =>
  findElements(
    tree,
    (element) => element.type === 'input' && element.props.name === name,
  )[0]?.props;

describe('the content waiver form', () => {
  test('a native post states the version and the tick', () => {
    assert({
      given: 'the form with no script',
      should: 'post the version and require the box',
      actual: [
        input('version')?.value,
        input('accepted')?.required,
        input('accepted')?.value,
      ],
      expected: [CONTENT_WAIVER_VERSION, true, 'yes'],
    });
  });

  test('it says it is a draft for counsel', () => {
    const lede = findElements(
      tree,
      (element) =>
        typeof element.props.children === 'string' &&
        element.props.children.includes('draft for counsel'),
    );
    assert({
      given: 'the waiver as a member reads it',
      should: 'call itself a draft for counsel',
      actual: lede.length,
      expected: 1,
    });
  });
});
