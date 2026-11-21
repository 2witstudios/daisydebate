import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { betaAccessTarget } from './beta-access-target';

const [operation, handle, username] = Bun.argv.slice(2);
const sql = new SQL(betaAccessTarget(process.env), { max: 1 });
try {
  const [identity] = await sql`select current_user as role`;
  if (identity?.role !== 'daisy_e2e')
    throw new Error('League fixture identity refused');
  if (operation === 'create') {
    const [owner] = await sql`select id from users where username=${username}`;
    if (!owner) throw new Error('League fixture host is missing');
    await sql`insert into organizations (id, kind, name, handle, owner_user_id, official)
      values (${createId()}, 'league', 'Southeast League', ${handle}, ${owner.id}, true)`;
  } else if (operation === 'close') {
    await sql`update organizations set official=false, closed_at=statement_timestamp()
      where handle=${handle} and kind='league'`;
  } else {
    throw new Error('Unknown league fixture operation');
  }
} finally {
  await sql.close();
}
