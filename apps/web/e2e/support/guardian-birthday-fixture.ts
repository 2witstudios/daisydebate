import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { betaAccessTarget } from './beta-access-target';
// Same isolated e2e role/database boundary as beta approval; never deploy data.
const url = betaAccessTarget(process.env);
const client = new SQL(url, { max: 1 });
const carriedUsername = Bun.argv[2];
if (!carriedUsername) throw new Error('Missing birthday fixture username');
try {
  const [identity] = await client`select current_user as role`;
  if (identity?.role !== 'daisy_e2e')
    throw new Error('Birthday fixture identity refused');
  const lobby = await client.begin(async (tx) => {
    const [league] = await tx`select id from organizations where official`;
    if (!league) throw new Error('Missing official league');
    const id = createId();
    const name = `Birthday Open ${id.slice(0, 6)}`;
    await tx`select set_config('daisy.organization_scope', ${league.id}, true),
      set_config('daisy.lobby_scope', ${id}, true)`;
    await tx`insert into lobbies (id, kind, owner_organization_id, name, handle, age_rule)
      values (${id}, 'standing', ${league.id}, ${name}, ${id}, 'adults')`;
    await tx`insert into seasons (id, lobby_id, organization_id, name, starts_at, status)
      values (${createId()}, ${id}, ${league.id}, 'Birthday season', now() - interval '2 months', 'active')`;
    const [aged] = await tx`update account_age age
      set birth_month=to_char(clock_timestamp() at time zone 'UTC' - interval '18 years','YYYY-MM'),
        recorded_at=now() - interval '1 year', version=age.version+1
      from users u where u.id=age.user_id and u.username=${carriedUsername}
      returning age.user_id`;
    if (!aged) throw new Error('Missing birthday age evidence');
    return { id, name };
  });
  process.stdout.write(JSON.stringify(lobby));
} finally {
  await client.close();
}
