import type { PeopleList, Person } from '@daisy/protocol';

/**
 * The next page added to what is loaded. Being online is part of the keyset, so
 * someone who went offline between reads comes back on a later page: they keep
 * their place and take the later read, because it is the fresher one.
 */
export const mergePages = (
  loaded: PeopleList,
  next: PeopleList,
): PeopleList => {
  const byName = new Map<string, Person>();
  for (const person of [...loaded.people, ...next.people])
    byName.set(person.username, person);
  return { ...next, people: [...byName.values()] };
};
