/**
 * A constant list that names every member of the union `Member`: an entry
 * outside the union, or a member the list leaves out, fails to compile. So a
 * list a database CHECK or an enum is built from cannot drift from the union
 * the code switches over. Curried: the union is given, the list is inferred.
 */
export const everyMemberOf =
  <Member>() =>
  <const List extends readonly Member[]>(
    list: List & ([Member] extends [List[number]] ? unknown : never),
  ): List =>
    list;
