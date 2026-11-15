/**
 * The people and places of the large sample tournament: 200 entries, 60
 * schools and 150 judges, named the same way every time. The names the
 * ordinary sample already uses come first, so its rooms, fixtures and
 * addresses are still there at scale.
 */

const surnames = [
  'Jensen',
  'Castillo',
  'Okafor',
  'Amari',
  'Doyle',
  'Haddad',
  'Wu',
  'Sato',
  'Brooks',
  'Petrov',
  'Lindqvist',
  'Mbeki',
  'Farrow',
  'Okoye',
  'Reid',
  'Nakata',
  'Ellis',
  'Lowe',
  'Ferreira',
  'Haas',
  'Kim',
  'Ahmed',
  'Rao',
  'Brennan',
  'Moreau',
  'Ochoa',
  'Nair',
  'Varga',
  'Lin',
  'Vance',
  'Ito',
  'Quinn',
  'Adeyemi',
  'Morales',
  'Berg',
  'Hale',
  'Kowalski',
  'Price',
  'Osei',
  'Tran',
  'Fischer',
  'Ward',
  'Lim',
  'Cole',
  'Nash',
  'Abbott',
  'Bianchi',
  'Chen',
  'Dalton',
  'Eze',
  'Flores',
  'Grant',
  'Hughes',
  'Iqbal',
  'Jovanovic',
  'Kaur',
  'Laine',
  'Mendes',
  'Novak',
  'Olsen',
  'Park',
  'Quist',
  'Russo',
  'Silva',
  'Tanaka',
  'Ueda',
  'Vos',
  'Weber',
  'Yilmaz',
  'Zhou',
  'Asante',
  'Bauer',
  'Costa',
  'Diaz',
  'Engel',
  'Fox',
  'Garcia',
  'Holt',
  'Ivers',
  'Jung',
  'Keller',
  'Lund',
  'Marsh',
  'Nolan',
  'Ortiz',
  'Pruitt',
  'Ramos',
  'Stone',
  'Torres',
  'Usman',
  'Vidal',
  'Wolfe',
  'Young',
  'Zamora',
  'Achebe',
  'Banks',
  'Cruz',
  'Dunn',
  'Evans',
  'Frost',
] as const;

/** The second half of a double-barrelled name, once the plain ones run out. */
const seconds = ['Hart', 'Lyle', 'Moss', 'Grey'] as const;

/** The nth surname (up to 500): plain for the first hundred, then double-barrelled. */
export const largeSurname = (n: number): string => {
  const plain = surnames[n % surnames.length] ?? 'Ellis';
  const round = Math.floor(n / surnames.length);
  return round === 0
    ? plain
    : `${plain}-${seconds[(round - 1) % seconds.length] ?? 'Hart'}`;
};

const schools = [
  'Ridgeview',
  'Hartwell',
  'Lakeside',
  'Ashford',
  'Bayview',
  'Brook Hill',
  'Cedar Park',
  'Eastgate',
  'Marlow',
  'Pine Ridge',
  'Ardmore',
  'Belmont',
  'Carver',
  'Dunmore',
  'Elmwood',
  'Fairview',
  'Glenbrook',
  'Highgate',
  'Ironwood',
  'Juniper',
  'Kingsley',
  'Linden',
  'Maplewood',
  'Northfield',
  'Oakridge',
  'Parkside',
  'Queensbury',
  'Riverside',
  'Stonebridge',
  'Thornbury',
  'Upton',
  'Valley View',
  'Westbrook',
  'Willow Creek',
  'Yarrow',
  'Alder',
  'Birchwood',
  'Clearwater',
  'Deerfield',
  'Easton',
  'Foxhall',
  'Greenway',
  'Holloway',
  'Inglewood',
  'Jefferson',
  'Kirkwood',
  'Lowell',
  'Midvale',
  'Newbury',
  'Orchard Hill',
  'Prescott',
  'Redmond',
  'Southgate',
  'Tamarack',
  'Union',
  'Vista',
  'Whitfield',
  'Wexford',
  'Yorkton',
  'Zephyr Hills',
] as const;

export const largeSchoolCount = schools.length;

/** The nth of the sixty schools, in name order after the ordinary sample's. */
export const largeSchool = (n: number): string =>
  schools[n % schools.length] ?? 'Ridgeview';

/** Judges keep the ordinary sample's names first. */
const judges = [
  'L. Malik',
  'P. Nguyen',
  'T. Abara',
  'A. Costa',
  'S. Cho',
  'R. Keane',
  'E. Fontaine',
  'A. Shah',
  'M. Reyes',
  'K. Osei',
  'D. Marsh',
  'H. Okonkwo',
  'J. Pruitt',
  'N. Varga',
  'B. Achebe',
  'C. Moreau',
  'I. Tanaka',
  'R. Lindqvist',
] as const;
const initials = 'ABCDEFGHJKLMNPRSTW';

/** The nth judge: the ordinary sample's, then an initial and a surname. */
export const largeJudge = (n: number): string => {
  const known = judges[n];
  if (known !== undefined) return known;
  const rest = n - judges.length;
  return `${initials[rest % initials.length] ?? 'A'}. ${largeSurname(rest + 45)}`;
};

/** Spread n things over a count of buckets the same way every time. */
export const spread = (n: number, buckets: number): number =>
  (n * 37 + 11) % buckets;

/** A generated entrant's school, shared by the sample's draw and standings. */
export const largeEntrySchool = (name: string): string | null => {
  const n = Array.from({ length: 200 }, (_, index) => index).find(
    (index) => largeSurname(index) === name,
  );
  return n === undefined ? null : largeSchool(spread(n, largeSchoolCount));
};
