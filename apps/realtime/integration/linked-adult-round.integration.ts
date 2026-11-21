import type { SQL } from 'bun';
import { systemId } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import { foundationSettings } from '@daisy/db/reference-formats';
import {
  buildChannelTopic,
  buildRoundTopic,
  emptyRuntimeCheckpointFor,
} from '@daisy/protocol';
import { fixtureRules, oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { SocketData } from '../src/socket';
import { openAuthorityPeer } from './authority-peer.test-support';
import { observeNativeServe } from './paused-reader.test-support';
import {
  issueAuthorityTicket,
  socketAuthorityFixture,
} from './socket-authority.test-support';
import { waitFor } from './support';

setupRitewayBun();
requireTestServices(process.env);

/**
 * A running Youth Room Round seating a minor, with its floor chat, and the
 * minor's school, owned by another adult. `coach` grants the fixture's own
 * participant a roster grant there; without it they are a stranger.
 */
const youthRound = async (
  client: SQL,
  participant: { readonly userId: string },
  coach: boolean,
) => {
  const studentId = systemId.next();
  const studentActorId = systemId.next();
  const ownerId = systemId.next();
  const schoolId = systemId.next();
  const formatId = systemId.next();
  const roomId = systemId.next();
  const roundId = systemId.next();
  const channelId = systemId.next();
  const rules = fixtureRules(oneOnOneFormatFixture);
  const close = async () => {
    await client`delete from messaging_channel_streams where channel_id=${channelId}`;
    await client`delete from messaging_channels where id=${channelId}`;
    await client`delete from rounds where id=${roundId}`;
    await client`delete from rooms where id=${roomId}`;
    await client`delete from formats where id=${formatId}`;
    await client`delete from format_revisions where format_id=${formatId}`;
    await client.begin(async (tx) => {
      // Grants are append-only by trigger; only this test's rows go.
      await tx`set local session_replication_role = replica`;
      await tx`delete from grants where organization_id=${schoolId}`;
      await tx`delete from membership_periods where organization_id=${schoolId}`;
      await tx`delete from memberships where organization_id=${schoolId}`;
      await tx`delete from organizations where id=${schoolId}`;
    });
    await client`delete from actors where id=${studentActorId}`;
    await client`delete from users where id in (${studentId}, ${ownerId})`;
  };
  try {
    await client`insert into users(id,username) values(${studentId},${studentId}),(${ownerId},${ownerId})`;
    await client`insert into account_age(user_id,birth_month,version,recorded_at)
      values(${studentId},to_char(now()-interval '16 years 6 months','YYYY-MM'),1,now()-interval '1 second'),
        (${ownerId},'1980-01',1,now()-interval '1 second')`;
    await client`insert into actors(id,kind,user_id) values(${studentActorId},'human',${studentId})`;
    await client`insert into organizations(id,kind,name,handle,owner_user_id)
      values(${schoolId},'school','Riverside High',${`riverside-${schoolId.slice(0, 8)}`},${ownerId})`;
    await client`insert into memberships(organization_id,user_id,status,joined_at)
      values(${schoolId},${studentId},'active',now()),(${schoolId},${participant.userId},'active',now())`;
    if (coach) {
      const [role] = await client`select r.id from roles r
        join role_permissions p on p.role_id = r.id
        where r.preset and p.permission = 'school.roster.manage' limit 1`;
      await client`insert into grants(id,role_id,user_id,scope_kind,organization_id,granted_at)
        values(${systemId.next()},${role!.id},${participant.userId},'organization',${schoolId},now())`;
    }
    await client`insert into format_revisions(format_id,version,definition) values(${formatId},1,${oneOnOneFormatFixture})`;
    await client`insert into formats(id,name,current_version) values(${formatId},'Linked adult fixture',1)`;
    const [lobby] =
      await client`select l.id from lobbies l join organizations o on o.id=l.owner_organization_id
      where o.official and l.kind='standing' and l.age_rule='under-18'`;
    await client`insert into rooms(id,lobby_id,host_actor_id,title,topic,visibility,format_id,format_version,competition_type,config,execution_plan,rules_snapshot,status)
      values(${roomId},${lobby!.id},${studentActorId},'Thursday scrimmage','Cities should ban cars','public',${formatId},1,'casual',${foundationSettings},'{}'::jsonb,${rules}::jsonb,'assembling')`;
    // A Round's cast is fixed with it (round_participants_fixed_cast).
    await client.begin(async (tx) => {
      await tx`insert into rounds(id,room_id,room_config_snapshot,visibility,resolution,competition_type,format_id,format_version,rules_snapshot,runtime_state,status)
        values(${roundId},${roomId},${foundationSettings},'public','Cities should ban cars','casual',${formatId},1,${rules}::jsonb,${emptyRuntimeCheckpointFor(rules)}::jsonb,'opening')`;
      await tx`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot)
        values(${systemId.next()},${roundId},${studentActorId},'side','affirmative',0)`;
    });
    await client`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,round_id)
      values(${channelId},'round_floor','round.floor',1,'active',${roundId})`;
    await client`insert into messaging_channel_streams(channel_id) values(${channelId})`;
  } catch (error) {
    await close();
    throw error;
  }
  return {
    roundTopic: buildRoundTopic(roundId),
    floorTopic: buildChannelTopic(channelId),
    end: () =>
      client`update rounds set status='abandoned',completed_at=clock_timestamp() where id=${roundId}`,
    close,
  };
};

/**
 * ADR 0158 on the real socket server, bound to the restricted realtime role:
 * a youth debater's school coach subscribes to their student's live Youth
 * Round and its floor chat, through `daisy_round_linked_adult_actors`; a
 * member who is no linked adult is refused both; and once the Round ends the
 * periodic reauthorization drops both and completes.
 */
for (const coach of [true, false])
  test(`realtime admits a Youth Round's linked adult to its Round and floor topics (${coach ? 'coach' : 'stranger'})`, async () => {
    const sockets: Bun.ServerWebSocket<SocketData>[] = [];
    const fixture = await socketAuthorityFixture(
      observeNativeServe((socket) => sockets.push(socket)),
    );
    let round: Awaited<ReturnType<typeof youthRound>> | undefined;
    try {
      const seeded = await youthRound(fixture.client, fixture, coach);
      round = seeded;
      const port = fixture.runtime.server.port;
      if (port === undefined) throw new Error('Realtime listener unavailable');
      const peer = await openAuthorityPeer(
        port,
        await issueAuthorityTicket(fixture),
      );
      const answers = {
        round: (await peer.subscribe(seeded.roundTopic, 'linked-round')).type,
        floor: (await peer.subscribe(seeded.floorTopic, 'linked-floor')).type,
      };
      assert({
        given: coach
          ? 'a running Youth Round seating a minor whose school grants the viewer school.roster.manage'
          : 'the same Round and a viewer who belongs to the school without a roster grant',
        should: coach
          ? 'subscribe the coach to the Round topic and its floor chat'
          : 'refuse both, as to anyone outside the Round',
        actual: answers,
        expected: coach
          ? { round: 'subscribed', floor: 'subscribed' }
          : { round: 'error', floor: 'error' },
      });
      if (!coach) return;
      await seeded.end();
      fixture.advanceToRevalidation();
      await waitFor(
        () =>
          sockets.length === 1 &&
          !sockets[0]?.data.connection?.topics.has(seeded.roundTopic) &&
          !sockets[0]?.data.connection?.topics.has(seeded.floorTopic),
      );
      assert({
        given: 'the coach’s subscriptions and the Round ended without an event',
        should:
          'drop the Round topic and its floor chat at the periodic reauthorization and keep the socket open',
        actual: {
          round: sockets[0]?.data.connection?.topics.has(seeded.roundTopic),
          floor: sockets[0]?.data.connection?.topics.has(seeded.floorTopic),
          open: peer.socket.readyState === WebSocket.OPEN,
        },
        expected: { round: false, floor: false, open: true },
      });
    } finally {
      await fixture.runtime.close();
      await round?.close();
      await fixture.close();
    }
  });
