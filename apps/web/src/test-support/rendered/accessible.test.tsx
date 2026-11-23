import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Window } from 'happy-dom';
import { accessible, accessibleWithin, renderAccessible } from './accessible';

setupRitewayBun();

const thrown = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe('accessible: roles', () => {
  test('implicit roles from the element', () => {
    const view = accessible(
      '<main><h2>Rooms</h2><nav aria-label="Primary"><a href="/play">Play</a></nav><button>Save</button><ul><li>One</li></ul></main>',
    );
    assert({
      given: 'native elements',
      should: 'read their implicit roles',
      actual: [
        view.has('main'),
        view.has('heading', 'Rooms', { level: 2 }),
        view.has('navigation', 'Primary'),
        view.attribute('link', 'Play', 'href'),
        view.has('button', 'Save'),
        view.count('listitem'),
      ],
      expected: [true, true, true, '/play', true, 1],
    });
  });

  test('explicit roles override the element', () => {
    const view = accessible(
      '<div role="status">Saved</div><p role="alert">That did not save.</p><section aria-label="Ada">x</section>',
    );
    assert({
      given: 'role attributes and a labelled section',
      should: 'read the explicit role and the region',
      actual: [
        view.text('status'),
        view.text('alert'),
        view.has('region', 'Ada'),
      ],
      expected: ['Saved', 'That did not save.', true],
    });
  });

  test('a link without href is not a link', () => {
    assert({
      given: 'an anchor with no href',
      should: 'not be a link',
      actual: accessible('<a>Not a link</a>').count('link'),
      expected: 0,
    });
  });
});

describe('accessible: names', () => {
  test('names from every source', () => {
    const view = accessible(
      [
        '<button aria-label="Close dialog">×</button>',
        '<h2 id="t">Report ada</h2><dialog open aria-labelledby="t">Body</dialog>',
        '<label for="q">Search people</label><input id="q" type="search">',
        '<label>Username <input type="text"></label>',
        '<img src="/a.png" alt="Ada’s photo">',
        '<button><span>Send</span> <span>challenge</span></button>',
      ].join(''),
    );
    assert({
      given:
        'aria-label, aria-labelledby, label for, wrapping label, alt and text',
      should: 'compute each accessible name',
      actual: [
        view.has('button', 'Close dialog'),
        view.has('dialog', 'Report ada'),
        view.has('searchbox', 'Search people'),
        view.has('textbox', 'Username'),
        view.has('img', 'Ada’s photo'),
        view.has('button', 'Send challenge'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('inline elements add no space to a name', () => {
    const view = accessible(
      '<label><input type="checkbox"> I agree to the <a href="/t">terms</a>.</label><button>Invite people (2 <span>pending</span>)</button><button><span>Send</span><div>now</div></button>',
    );
    assert({
      given: 'links and spans inside a name, and a block inside a button',
      should: 'join inline text as written and space only around the block',
      actual: [view.names('checkbox'), view.names('button')],
      expected: [
        ['I agree to the terms.'],
        ['Invite people (2 pending)', 'Send now'],
      ],
    });
  });

  test('display utilities in the markup decide the spacing', () => {
    assert({
      given: 'a link of two spans, one a block by its class',
      should: 'space them as the page lays them out',
      actual: accessible(
        '<a href="/a"><span class="block font-bold">1AC</span><span>The case</span></a><a href="/b"><span class="inline-flex">Live</span>now</a><a class="flex flex-col" href="/c"><span>1AC</span><span>The case</span></a>',
      ).names('link'),
      expected: ['1AC The case', 'Live now', '1AC The case'],
    });
  });

  test('names are exact unless a pattern is given', () => {
    const view = accessible('<button>Save draft</button>');
    assert({
      given: 'a partial name and a pattern',
      should: 'match only the pattern',
      actual: [view.has('button', 'Save'), view.has('button', /^Save/)],
      expected: [false, true],
    });
  });

  test('names lists every element of a role in order', () => {
    assert({
      given: 'three buttons',
      should: 'list their names in document order',
      actual: accessible(
        '<button>One</button><button aria-label="Two">2</button><button>Three</button>',
      ).names('button'),
      expected: ['One', 'Two', 'Three'],
    });
  });
});

describe('accessible: what it leaves out', () => {
  test('hidden subtrees are not in the tree', () => {
    const view = accessible(
      '<div hidden><button>Gone</button></div><div aria-hidden="true"><button>Also gone</button></div><div style="display:none"><button>Not shown</button></div><button>Here</button>',
    );
    assert({
      given: 'hidden, aria-hidden and display none',
      should: 'read only the shown button',
      actual: view.names('button'),
      expected: ['Here'],
    });
  });

  test('a closed dialog is named by its title when asked for', () => {
    assert({
      given: 'a closed dialog labelled by its heading',
      should: 'find it, hidden, by that name',
      actual: accessible(
        '<dialog aria-labelledby="t"><h2 id="t">Report ada</h2></dialog>',
      ).has('dialog', 'Report ada', { hidden: true }),
      expected: true,
    });
  });

  test('a hidden element is found when asked for', () => {
    assert({
      given: 'hidden: true',
      should: 'include hidden elements',
      actual: accessible('<div hidden><button>Gone</button></div>').count(
        'button',
        'Gone',
        { hidden: true },
      ),
      expected: 1,
    });
  });
});

describe('accessible: refusals', () => {
  test('a name that matches two elements fails loudly', () => {
    const view = accessible('<button>Save</button><button>Save</button>');
    assert({
      given: 'two buttons named Save',
      should: 'refuse get, has and text',
      actual: [
        thrown(() => view.get('button', 'Save')),
        thrown(() => view.has('button', 'Save')),
        thrown(() => view.text('button', 'Save')),
      ],
      expected: Array(3).fill(
        '2 elements with role button named Save; a role and name must pick one',
      ),
    });
  });

  test('a missing element fails loudly and says what is there', () => {
    assert({
      given: 'no button named Delete',
      should: 'refuse and list the buttons there are',
      actual: thrown(() =>
        accessible('<button>Save</button><button>Cancel</button>').get(
          'button',
          'Delete',
        ),
      ),
      expected:
        'No element with role button named Delete; role button has "Save", "Cancel"',
    });
  });

  test('a missing role says nothing has it', () => {
    assert({
      given: 'no dialog at all',
      should: 'say nothing has that role',
      actual: thrown(() => accessible('<p>Hi</p>').get('dialog')),
      expected: 'No element with role dialog; nothing has role dialog',
    });
  });

  test('has answers false for none', () => {
    assert({
      given: 'no button named Delete',
      should: 'answer false',
      actual: accessible('<button>Save</button>').has('button', 'Delete'),
      expected: false,
    });
  });
});

describe('accessible: scope and states', () => {
  test('within reads one subtree', () => {
    const view = accessible(
      '<section aria-label="Ada"><button>Message</button></section><section aria-label="Bo"><button>Message</button></section>',
    );
    assert({
      given: 'two regions each with a Message button',
      should: 'find the one inside the named region',
      actual: view.within('region', 'Bo').has('button', 'Message'),
      expected: true,
    });
  });

  test('states narrow a query', () => {
    const view = accessible(
      '<button aria-pressed="true">Bold</button><button aria-pressed="false">Italic</button><button aria-expanded="true">Menu</button><input type="checkbox" aria-label="Ready" checked>',
    );
    assert({
      given: 'pressed, expanded and checked states',
      should: 'match on them',
      actual: [
        view.names('button', { pressed: true }),
        view.has('button', 'Menu', { expanded: true }),
        view.has('checkbox', 'Ready', { checked: true }),
        view.has('checkbox', 'Ready', { checked: false }),
      ],
      expected: [['Bold'], true, true, false],
    });
  });

  test('each read is its own document', () => {
    const first = accessible(
      '<label for="q">Search people</label><input id="q">',
    );
    const second = accessible(
      '<label for="q">Search rooms</label><input id="q">',
    );
    assert({
      given: 'two reads that reuse an id',
      should: 'resolve each label in its own output, and keep the first whole',
      actual: [first.names('textbox'), second.names('textbox')],
      expected: [['Search people'], ['Search rooms']],
    });
  });

  test('renderAccessible renders a React element', () => {
    assert({
      given: 'a React element',
      should: 'read its rendered roles',
      actual: renderAccessible(
        h('nav', { 'aria-label': 'Tabs' }, h('a', { href: '/x' }, 'X')),
      ).attribute('link', 'X', 'href'),
      expected: '/x',
    });
  });

  test('accessibleWithin reads a live element', () => {
    const { document } = new Window();
    const container = document.createElement('div');
    container.innerHTML = '<button aria-pressed="true">Mute</button>';
    document.body.append(container);
    assert({
      given: 'a mounted container',
      should: 'read its roles as they are now',
      actual: accessibleWithin(container as unknown as Element).has(
        'button',
        'Mute',
        { pressed: true },
      ),
      expected: true,
    });
  });
});
