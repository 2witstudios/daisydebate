import type {
  ClubBillingView,
  ClubSeatsView,
} from '../../features/clubs/views';

const id = (letter: string) => letter.repeat(24);

export const plan: ClubSeatsView['plan'] = {
  state: 'active',
  seatCount: 14,
  seatsUsed: 10,
  lowestSeatCount: 10,
  renewsAt: '2026-12-01T00:00:00.000Z',
  periodStartsAt: '2026-11-01T00:00:00.000Z',
  periodEndsAt: '2026-12-01T00:00:00.000Z',
  seatPriceMinor: 1000,
  monthlyTotalMinor: 14000,
};

const seat = (letter: string, name: string, ladder: 'youth' | 'open') => ({
  userId: id(letter),
  name,
  username: name.split(' ')[0]!.toLowerCase(),
  ladder,
  assignedAt: '2026-11-02T00:00:00.000Z',
  funded: true,
});

export const seatsView: ClubSeatsView = {
  club: {
    id: id('c'),
    name: 'Lakeside Debate',
    handle: 'lakeside-debate',
    kind: 'school',
  },
  plan,
  seats: [
    seat('a', 'Sam Rivera', 'youth'),
    seat('b', 'Theo Haddad', 'youth'),
    seat('d', 'Maya Chen', 'youth'),
    seat('e', 'Priya Nair', 'youth'),
    seat('f', 'Imani Wu', 'youth'),
    seat('g', 'Jordan Brooks', 'youth'),
    seat('h', 'Leo Castillo', 'open'),
    seat('j', 'Ana Petrov', 'open'),
  ],
  invitations: [
    {
      id: id('k'),
      email: 'rosa.j@lakeside.edu',
      expiresAt: '2026-11-30T00:00:00.000Z',
      expired: false,
    },
    {
      id: id('m'),
      email: 'ben.adeyemi@lakeside.edu',
      expiresAt: '2026-11-27T00:00:00.000Z',
      expired: false,
    },
  ],
  members: [
    { userId: id('n'), name: 'Nia Okafor', username: 'nia', ladder: 'youth' },
  ],
};

export const billingView: ClubBillingView = {
  club: seatsView.club,
  plan,
  invoices: [
    {
      id: 'in_renewal',
      date: '2026-11-01T00:00:00.000Z',
      kind: 'renewal',
      totalMinor: 14000,
      status: 'paid',
    },
    {
      id: 'in_change',
      date: '2026-10-14T00:00:00.000Z',
      kind: 'seat-change',
      totalMinor: 1161,
      status: 'paid',
    },
  ],
  portalAvailable: true,
  purchaseAvailable: true,
};

export const noAction = async () => ({ kind: 'done' }) as const;
