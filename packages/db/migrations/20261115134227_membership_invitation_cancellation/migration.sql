ALTER TABLE "memberships" DROP CONSTRAINT "memberships_joined_once_accepted", ADD CONSTRAINT "memberships_joined_once_accepted" CHECK (case "status"
        when 'active' then "joined_at" is not null
        when 'ended' then true
        else "joined_at" is null end);