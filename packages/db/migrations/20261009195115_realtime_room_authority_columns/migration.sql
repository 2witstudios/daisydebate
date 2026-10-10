-- Minimal canonical Room authorization projection; no content, labels or mutation privilege.
GRANT SELECT (id, host_actor_id, visibility, status, version) ON public.rooms TO daisy_realtime;
--> statement-breakpoint
GRANT SELECT (room_id, actor_id, role, slot) ON public.room_participants TO daisy_realtime;
