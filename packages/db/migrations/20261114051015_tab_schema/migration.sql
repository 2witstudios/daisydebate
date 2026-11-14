CREATE TABLE "ballot_definition_versions" (
	"ballot_definition_id" text,
	"version" integer,
	"organization_id" text,
	"lobby_id" text,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ballot_definition_versions_pkey" PRIMARY KEY("ballot_definition_id","version"),
	CONSTRAINT "ballot_definition_versions_one_tenant_key" CHECK (num_nonnulls("organization_id", "lobby_id") = 1),
	CONSTRAINT "ballot_definition_versions_version_positive" CHECK ("version" > 0),
	CONSTRAINT "ballot_definition_versions_definition_is_object" CHECK (jsonb_typeof("definition") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ballot_definitions" (
	"id" text PRIMARY KEY,
	"organization_id" text,
	"lobby_id" text,
	"name" text NOT NULL,
	"current_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ballot_definitions_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "ballot_definitions_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "ballot_definitions_one_tenant_key" CHECK (num_nonnulls("organization_id", "lobby_id") = 1),
	CONSTRAINT "ballot_definitions_current_version_positive" CHECK ("current_version" > 0),
	CONSTRAINT "ballot_definitions_name_nonempty" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "ballot_screenings" (
	"ballot_id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"released_text" jsonb,
	"screened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ballot_screenings_status_check" CHECK ("status" in ('pending', 'clear', 'held')),
	CONSTRAINT "ballot_screenings_screened_consistent" CHECK (("status" <> 'pending') = ("screened_at" is not null)),
	CONSTRAINT "ballot_screenings_released_text_is_object" CHECK (jsonb_typeof("released_text") = 'object')
);
--> statement-breakpoint
CREATE TABLE "certification_results" (
	"certification_id" text,
	"result_id" text,
	"event_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	CONSTRAINT "certification_results_pkey" PRIMARY KEY("certification_id","result_id")
);
--> statement-breakpoint
CREATE TABLE "certifications" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"scope" text NOT NULL,
	"command_id" text NOT NULL,
	"certified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "certifications_id_event_unique" UNIQUE("id","event_id","lobby_id"),
	CONSTRAINT "certifications_scope_check" CHECK ("scope" in ('result', 'event'))
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"user_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"basis" text NOT NULL,
	"handling" text NOT NULL,
	"confirmed_by_user_id" text,
	"detected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conflicts_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "conflicts_basis_check" CHECK ("basis" in ('seated', 'school_entry', 'ward', 'declared')),
	CONSTRAINT "conflicts_handling_check" CHECK ("handling" in ('denied', 'second_confirms', 'flagged')),
	CONSTRAINT "conflicts_confirmer_check" CHECK ("confirmed_by_user_id" is null or ("handling" = 'second_confirms' and "confirmed_by_user_id" <> "user_id"))
);
--> statement-breakpoint
CREATE TABLE "pending_commands" (
	"command_id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"proposer_user_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_digest" text NOT NULL,
	"expected" jsonb NOT NULL,
	"conflict_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_commands_status_check" CHECK ("status" in ('pending', 'confirmed', 'declined', 'withdrawn', 'lapsed')),
	CONSTRAINT "pending_commands_settled_consistent" CHECK (("status" <> 'pending') = ("settled_at" is not null)),
	CONSTRAINT "pending_commands_settler_check" CHECK (("status" in ('confirmed', 'declined', 'withdrawn')) = ("settled_by_user_id" is not null)),
	CONSTRAINT "pending_commands_second_person" CHECK (case when "status" in ('confirmed', 'declined') then "settled_by_user_id" <> "proposer_user_id"
        when "status" = 'withdrawn' then "settled_by_user_id" = "proposer_user_id"
        else true end),
	CONSTRAINT "pending_commands_type_nonempty" CHECK (length(trim("type")) > 0),
	CONSTRAINT "pending_commands_digest_check" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "pending_commands_payload_is_object" CHECK (jsonb_typeof("payload") = 'object'),
	CONSTRAINT "pending_commands_expected_is_object" CHECK (jsonb_typeof("expected") = 'object')
);
--> statement-breakpoint
CREATE TABLE "draw_fixtures" (
	"draw_id" text,
	"tab_round_id" text NOT NULL,
	"event_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"fixture_id" text,
	CONSTRAINT "draw_fixtures_pkey" PRIMARY KEY("draw_id","fixture_id")
);
--> statement-breakpoint
CREATE TABLE "draw_result_inputs" (
	"draw_id" text,
	"tab_round_id" text NOT NULL,
	"event_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"result_id" text,
	CONSTRAINT "draw_result_inputs_pkey" PRIMARY KEY("draw_id","result_id")
);
--> statement-breakpoint
CREATE TABLE "draws" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"tab_round_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"based_on_draw_id" text,
	"method" text NOT NULL,
	"engine_version" text,
	"inputs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draws_id_tab_round_unique" UNIQUE("id","tab_round_id","event_id","lobby_id"),
	CONSTRAINT "draws_version_unique" UNIQUE("tab_round_id","version"),
	CONSTRAINT "draws_version_positive" CHECK ("version" > 0),
	CONSTRAINT "draws_status_check" CHECK ("status" in ('draft', 'published')),
	CONSTRAINT "draws_method_check" CHECK ("method" in ('typed', 'computed')),
	CONSTRAINT "draws_published_consistent" CHECK (("status" = 'published') = ("published_at" is not null)),
	CONSTRAINT "draws_engine_when_computed" CHECK (("method" = 'computed') = ("engine_version" is not null)),
	CONSTRAINT "draws_inputs_is_object" CHECK (jsonb_typeof("inputs") = 'object')
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"seed" integer,
	"division" text,
	"responsible_kind" text NOT NULL,
	"school_organization_id" text,
	"school_organization_kind" text GENERATED ALWAYS AS ('school') STORED NOT NULL,
	"guardian_link_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "entries_id_event_unique" UNIQUE("id","event_id","lobby_id"),
	CONSTRAINT "entries_status_check" CHECK ("status" in ('pending', 'accepted', 'withdrawn')),
	CONSTRAINT "entries_one_responsible_adult" CHECK (("responsible_kind" = 'school' and "school_organization_id" is not null and "guardian_link_id" is null)
        or ("responsible_kind" = 'guardian' and "guardian_link_id" is not null and "school_organization_id" is null)
        or ("responsible_kind" = 'self' and "school_organization_id" is null and "guardian_link_id" is null)),
	CONSTRAINT "entries_division_nonempty" CHECK ("division" is null or length(trim("division")) > 0),
	CONSTRAINT "entries_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "entries_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "entry_members" (
	"entry_id" text,
	"actor_id" text,
	"event_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_members_pkey" PRIMARY KEY("entry_id","actor_id"),
	CONSTRAINT "entry_members_one_entry_per_event" UNIQUE("event_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"format_id" text NOT NULL,
	"format_version" integer NOT NULL,
	"ballot_definition_id" text,
	"ballot_definition_version" integer,
	"template_id" text,
	"entry_kind" text NOT NULL,
	"team_size" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"entries_version" integer DEFAULT 1 NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "events_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "events_ballot_definition_complete" CHECK (("ballot_definition_id" is null) = ("ballot_definition_version" is null)),
	CONSTRAINT "events_entry_kind_check" CHECK ("entry_kind" in ('person', 'team')),
	CONSTRAINT "events_team_size_check" CHECK ("team_size" >= 1 and ("entry_kind" = 'person') = ("team_size" = 1)),
	CONSTRAINT "events_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "events_version_positive" CHECK ("version" > 0),
	CONSTRAINT "events_entries_version_positive" CHECK ("entries_version" > 0),
	CONSTRAINT "events_settings_version_positive" CHECK ("settings_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "stages" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"kind" text NOT NULL,
	"sequence" integer NOT NULL,
	"division" text,
	"place" text NOT NULL,
	"timing" text NOT NULL,
	"window_opens_at" timestamp with time zone,
	"window_closes_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stages_id_event_unique" UNIQUE("id","event_id","lobby_id"),
	CONSTRAINT "stages_sequence_unique" UNIQUE("event_id","sequence"),
	CONSTRAINT "stages_kind_check" CHECK ("kind" in ('preliminary', 'elimination')),
	CONSTRAINT "stages_place_check" CHECK ("place" in ('online', 'in_person')),
	CONSTRAINT "stages_timing_check" CHECK ("timing" in ('live', 'windowed')),
	CONSTRAINT "stages_sequence_positive" CHECK ("sequence" > 0),
	CONSTRAINT "stages_division_is_elimination" CHECK ("division" is null or ("kind" = 'elimination' and length(trim("division")) > 0)),
	CONSTRAINT "stages_window_check" CHECK (case when "timing" = 'windowed'
        then "window_opens_at" is not null and "window_closes_at" is not null and "window_closes_at" > "window_opens_at"
        else "window_opens_at" is null and "window_closes_at" is null end),
	CONSTRAINT "stages_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tab_rounds" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"stage_id" text NOT NULL,
	"number" integer NOT NULL,
	"name" text,
	"time_slot_id" text,
	"resolution_pool_id" text,
	"pool_resolution_id" text,
	"resolution_released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tab_rounds_id_event_unique" UNIQUE("id","event_id","lobby_id"),
	CONSTRAINT "tab_rounds_number_unique" UNIQUE("stage_id","number"),
	CONSTRAINT "tab_rounds_number_positive" CHECK ("number" > 0),
	CONSTRAINT "tab_rounds_name_nonempty" CHECK ("name" is null or length(trim("name")) > 0),
	CONSTRAINT "tab_rounds_wording_from_pool" CHECK ("pool_resolution_id" is null or "resolution_pool_id" is not null),
	CONSTRAINT "tab_rounds_released_wording" CHECK ("resolution_released_at" is null or "pool_resolution_id" is not null),
	CONSTRAINT "tab_rounds_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "time_slots" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "time_slots_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "time_slots_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "time_slots_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "fixture_entries" (
	"fixture_id" text,
	"tab_round_id" text NOT NULL,
	"event_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"fixture_status" text DEFAULT 'draft' NOT NULL,
	"entry_id" text,
	"position" integer NOT NULL,
	"side" text,
	CONSTRAINT "fixture_entries_pkey" PRIMARY KEY("fixture_id","entry_id"),
	CONSTRAINT "fixture_entries_position_unique" UNIQUE("fixture_id","position"),
	CONSTRAINT "fixture_entries_position_nonnegative" CHECK ("position" >= 0),
	CONSTRAINT "fixture_entries_side_nonempty" CHECK ("side" is null or length(trim("side")) > 0)
);
--> statement-breakpoint
CREATE TABLE "fixture_judges" (
	"fixture_id" text,
	"tab_round_id" text NOT NULL,
	"event_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"fixture_status" text DEFAULT 'draft' NOT NULL,
	"tournament_judge_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixture_judges_pkey" PRIMARY KEY("fixture_id","tournament_judge_id")
);
--> statement-breakpoint
CREATE TABLE "fixtures" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"tab_round_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"room_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "fixtures_id_tab_round_unique" UNIQUE("id","tab_round_id","event_id","lobby_id"),
	CONSTRAINT "fixtures_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "fixtures_id_status_unique" UNIQUE("id","status"),
	CONSTRAINT "fixtures_kind_check" CHECK ("kind" in ('pairing', 'section', 'bye')),
	CONSTRAINT "fixtures_status_check" CHECK ("status" in ('draft', 'published', 'withdrawn')),
	CONSTRAINT "fixtures_lifecycle_instants" CHECK (("published_at" is not null) = ("status" <> 'draft') and ("withdrawn_at" is not null) = ("status" = 'withdrawn')),
	CONSTRAINT "fixtures_room_when_published" CHECK (("room_id" is not null) = ("status" <> 'draft' and "kind" <> 'bye')),
	CONSTRAINT "fixtures_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "action_history" (
	"command_id" text PRIMARY KEY,
	"organization_id" text,
	"lobby_id" text,
	"actor_user_id" text,
	"service_id" text,
	"authority" text NOT NULL,
	"grant_id" text,
	"relation" text,
	"aggregate_kind" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"conflict_id" text,
	"type" text NOT NULL,
	"payload_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "action_history_command_lobby_unique" UNIQUE("command_id","lobby_id"),
	CONSTRAINT "action_history_one_tenant_key" CHECK (num_nonnulls("organization_id", "lobby_id") = 1),
	CONSTRAINT "action_history_one_principal" CHECK (("actor_user_id" is null) <> ("service_id" is null)),
	CONSTRAINT "action_history_authority_check" CHECK ("authority" in ('fixed', 'owner', 'grant', 'relationship', 'service')),
	CONSTRAINT "action_history_service_authority" CHECK (("authority" = 'service') = ("service_id" is not null)),
	CONSTRAINT "action_history_grant_authority" CHECK (("authority" = 'grant') = ("grant_id" is not null)),
	CONSTRAINT "action_history_relationship_authority" CHECK (("authority" = 'relationship') = ("relation" is not null)),
	CONSTRAINT "action_history_conflict_in_lobby" CHECK ("conflict_id" is null or "lobby_id" is not null),
	CONSTRAINT "action_history_aggregate_kind_nonempty" CHECK (length(trim("aggregate_kind")) > 0),
	CONSTRAINT "action_history_aggregate_id_nonempty" CHECK (length(trim("aggregate_id")) > 0),
	CONSTRAINT "action_history_digest_check" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "action_history_result_is_object" CHECK (jsonb_typeof("result") = 'object')
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" text PRIMARY KEY,
	"role_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"organization_id" text,
	"lobby_id" text,
	"granted_by_user_id" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	CONSTRAINT "grants_scope_kind_check" CHECK ("scope_kind" in ('organization', 'lobby')),
	CONSTRAINT "grants_scope_check" CHECK (("scope_kind" = 'organization' and "organization_id" is not null and "lobby_id" is null)
        or ("scope_kind" = 'lobby' and "lobby_id" is not null and "organization_id" is null)),
	CONSTRAINT "grants_one_tenant_key" CHECK (num_nonnulls("organization_id", "lobby_id") = 1),
	CONSTRAINT "grants_expires_after_granted" CHECK ("expires_at" is null or "expires_at" > "granted_at"),
	CONSTRAINT "grants_revocation_check" CHECK (("revoked_at" is null) = ("revoked_by_user_id" is null) and ("revoked_at" is null or "revoked_at" >= "granted_at"))
);
--> statement-breakpoint
CREATE TABLE "guardian_links" (
	"id" text PRIMARY KEY,
	"guardian_user_id" text NOT NULL,
	"minor_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"via_organization_id" text,
	"via_organization_kind" text GENERATED ALWAYS AS ('school') STORED NOT NULL,
	"status" text NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "guardian_links_id_people_unique" UNIQUE("id","guardian_user_id","minor_user_id"),
	CONSTRAINT "guardian_links_kind_check" CHECK ("kind" in ('parent', 'coach')),
	CONSTRAINT "guardian_links_status_check" CHECK ("status" in ('pending', 'active', 'ended')),
	CONSTRAINT "guardian_links_two_people" CHECK ("guardian_user_id" <> "minor_user_id"),
	CONSTRAINT "guardian_links_coach_via_school" CHECK (("kind" = 'coach') = ("via_organization_id" is not null)),
	CONSTRAINT "guardian_links_ended_consistent" CHECK (("status" = 'ended') = ("ended_at" is not null)),
	CONSTRAINT "guardian_links_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "restriction_lobbies" (
	"guardian_link_id" text,
	"guardian_user_id" text NOT NULL,
	"minor_user_id" text NOT NULL,
	"lobby_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restriction_lobbies_pkey" PRIMARY KEY("guardian_link_id","lobby_id")
);
--> statement-breakpoint
CREATE TABLE "restrictions" (
	"guardian_link_id" text PRIMARY KEY,
	"guardian_user_id" text NOT NULL,
	"minor_user_id" text NOT NULL,
	"limits_lobbies" boolean DEFAULT false NOT NULL,
	"video_audience_cap" text DEFAULT 'lobby' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "restrictions_link_people_unique" UNIQUE("guardian_link_id","guardian_user_id","minor_user_id"),
	CONSTRAINT "restrictions_video_audience_cap_check" CHECK ("video_audience_cap" in ('officials', 'lobby')),
	CONSTRAINT "restrictions_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "ladders" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"lobby_kind" text GENERATED ALWAYS AS ('standing') STORED NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ladders_name_nonempty" CHECK (length(trim("name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "lobbies" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"owner_user_id" text,
	"owner_organization_id" text,
	"owner_organization_kind" text GENERATED ALWAYS AS ('league') STORED NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "lobbies_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "lobbies_id_owner_organization_unique" UNIQUE("id","owner_organization_id"),
	CONSTRAINT "lobbies_kind_check" CHECK ("kind" in ('standing', 'tournament')),
	CONSTRAINT "lobbies_one_owner" CHECK (num_nonnulls("owner_user_id", "owner_organization_id") = 1),
	CONSTRAINT "lobbies_standing_is_organization_owned" CHECK ("kind" <> 'standing' or "owner_organization_id" is not null),
	CONSTRAINT "lobbies_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "lobbies_handle_nonempty" CHECK (length(trim("handle")) > 0),
	CONSTRAINT "lobbies_version_positive" CHECK ("version" > 0),
	CONSTRAINT "lobbies_settings_version_positive" CHECK ("settings_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"lobby_id" text PRIMARY KEY,
	"lobby_kind" text GENERATED ALWAYS AS ('tournament') STORED NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"admits_minors" boolean DEFAULT false NOT NULL,
	"link_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_status_check" CHECK ("status" in ('draft', 'open', 'running', 'completed', 'cancelled')),
	CONSTRAINT "tournaments_link_hash_check" CHECK ("link_hash" is null or "link_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organization_id" text,
	"user_id" text,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memberships_pkey" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "memberships_status_check" CHECK ("status" in ('invited', 'active', 'declined', 'ended')),
	CONSTRAINT "memberships_joined_once_accepted" CHECK (("status" in ('active', 'ended')) = ("joined_at" is not null)),
	CONSTRAINT "memberships_ended_consistent" CHECK (("status" = 'ended') = ("ended_at" is not null)),
	CONSTRAINT "memberships_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"owner_user_id" text,
	"billing_owner_user_id" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organizations_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "organizations_kind_check" CHECK ("kind" in ('league', 'school')),
	CONSTRAINT "organizations_has_owner" CHECK ("owner_user_id" is not null or "id" = 'fo05z182lha0a3usciy9wr2r'),
	CONSTRAINT "organizations_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "organizations_handle_nonempty" CHECK (length(trim("handle")) > 0),
	CONSTRAINT "organizations_version_positive" CHECK ("version" > 0),
	CONSTRAINT "organizations_settings_version_positive" CHECK ("settings_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" text,
	"organization_id" text NOT NULL,
	"permission" text,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role_id","permission"),
	CONSTRAINT "role_permissions_permission_check" CHECK ("permission" in ('organization.manage', 'organization.roles.manage', 'lobby.setup.manage', 'lobby.announce', 'action_history.read', 'tournament.entries.manage', 'tournament.draw.edit', 'tournament.draw.publish', 'tournament.rooms.officiate', 'tournament.results.enter', 'tournament.results.release', 'tournament.ballots.read_unreleased', 'tournament.resolutions.read_unreleased', 'school.roster.manage', 'school.ballots.read'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"preset" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "roles_rank_unique" UNIQUE("organization_id","rank"),
	CONSTRAINT "roles_rank_positive" CHECK ("rank" > 0),
	CONSTRAINT "roles_preset_is_daisy" CHECK (not "preset" or "organization_id" = 'fo05z182lha0a3usciy9wr2r'),
	CONSTRAINT "roles_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "roles_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"tab_round_id" text NOT NULL,
	"thing" text NOT NULL,
	"audience" text NOT NULL,
	"cause" text NOT NULL,
	"command_id" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "releases_once" UNIQUE("tab_round_id","thing","audience"),
	CONSTRAINT "releases_thing_check" CHECK ("thing" in ('posting', 'decision', 'scores', 'reason', 'feedback', 'video')),
	CONSTRAINT "releases_audience_check" CHECK ("audience" in ('responsible_adults', 'competitors', 'participants', 'link', 'public')),
	CONSTRAINT "releases_cause_check" CHECK ("cause" in ('at_once', 'round_close', 'prelims_end', 'break', 'certified', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "pool_resolutions" (
	"id" text PRIMARY KEY,
	"pool_id" text NOT NULL,
	"organization_id" text,
	"lobby_id" text,
	"text" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_resolutions_id_pool_unique" UNIQUE("id","pool_id"),
	CONSTRAINT "pool_resolutions_one_tenant_key" CHECK (num_nonnulls("organization_id", "lobby_id") = 1),
	CONSTRAINT "pool_resolutions_text_length" CHECK (length(trim("text")) between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "resolution_pools" (
	"id" text PRIMARY KEY,
	"organization_id" text,
	"lobby_id" text,
	"season_id" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "resolution_pools_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "resolution_pools_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "resolution_pools_one_tenant_key" CHECK (num_nonnulls("organization_id", "lobby_id") = 1),
	CONSTRAINT "resolution_pools_season_is_organizations" CHECK ("season_id" is null or "organization_id" is not null),
	CONSTRAINT "resolution_pools_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "resolution_pools_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "result_entries" (
	"result_id" text,
	"entry_id" text,
	"fixture_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"won" boolean,
	"rank" integer,
	"ballots_won" integer,
	CONSTRAINT "result_entries_pkey" PRIMARY KEY("result_id","entry_id"),
	CONSTRAINT "result_entries_result_entry_lobby_unique" UNIQUE("result_id","entry_id","lobby_id"),
	CONSTRAINT "result_entries_rank_positive" CHECK ("rank" is null or "rank" > 0),
	CONSTRAINT "result_entries_ballots_won_nonnegative" CHECK ("ballots_won" is null or "ballots_won" >= 0)
);
--> statement-breakpoint
CREATE TABLE "result_speakers" (
	"result_id" text,
	"actor_id" text,
	"entry_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"points" numeric,
	"rank" integer,
	CONSTRAINT "result_speakers_pkey" PRIMARY KEY("result_id","actor_id"),
	CONSTRAINT "result_speakers_points_nonnegative" CHECK ("points" is null or "points" >= 0),
	CONSTRAINT "result_speakers_rank_positive" CHECK ("rank" is null or "rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"tab_round_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"fixture_status" text GENERATED ALWAYS AS ('published') STORED NOT NULL,
	"kind" text NOT NULL,
	"administrative_reason" text,
	"round_id" text,
	"supersedes_result_id" text CONSTRAINT "results_superseded_once" UNIQUE,
	"correction_reason" text,
	"command_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "results_id_fixture_unique" UNIQUE("id","fixture_id","lobby_id"),
	CONSTRAINT "results_id_event_unique" UNIQUE("id","event_id","lobby_id"),
	CONSTRAINT "results_kind_check" CHECK ("kind" in ('decided', 'administrative')),
	CONSTRAINT "results_administrative_reason_check" CHECK (case when "kind" = 'administrative'
        then "administrative_reason" is not null and "administrative_reason" in ('bye', 'forfeit', 'double_loss', 'ruling')
        else "administrative_reason" is null end),
	CONSTRAINT "results_decided_has_round" CHECK ("kind" <> 'decided' or "round_id" is not null),
	CONSTRAINT "results_correction_has_reason" CHECK (case when "supersedes_result_id" is null
        then "correction_reason" is null
        else "correction_reason" is not null and length(trim("correction_reason")) > 0 end),
	CONSTRAINT "results_not_its_own_correction" CHECK ("supersedes_result_id" is distinct from "id")
);
--> statement-breakpoint
CREATE TABLE "sanctions" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"organization_kind" text GENERATED ALWAYS AS ('league') STORED NOT NULL,
	"lobby_id" text NOT NULL,
	"event_id" text NOT NULL,
	"season_id" text NOT NULL,
	"template_id" text NOT NULL,
	"status" text NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sanctions_once_per_league" UNIQUE("organization_id","event_id"),
	CONSTRAINT "sanctions_status_check" CHECK ("status" in ('requested', 'approved', 'declined', 'withdrawn')),
	CONSTRAINT "sanctions_decided_consistent" CHECK (case when "status" = 'requested' then "decided_at" is null
        when "status" in ('approved', 'declined') then "decided_at" is not null
        else true end),
	CONSTRAINT "sanctions_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "season_standing_rules" (
	"season_id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"counting" text NOT NULL,
	"counts_lobby_rooms" boolean DEFAULT false NOT NULL,
	"rule" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "season_standing_rules_counting_check" CHECK ("counting" in ('sanction', 'membership')),
	CONSTRAINT "season_standing_rules_rule_is_object" CHECK (jsonb_typeof("rule") = 'object'),
	CONSTRAINT "season_standing_rules_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY,
	"scope_kind" text NOT NULL,
	"organization_id" text,
	"template_id" text,
	"lobby_id" text,
	"event_id" text,
	"key" text NOT NULL,
	"hold" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_scope_kind_check" CHECK ("scope_kind" in ('organization', 'template', 'lobby', 'event')),
	CONSTRAINT "settings_scope_check" CHECK (("scope_kind" = 'organization' and "organization_id" is not null and "template_id" is null and "lobby_id" is null and "event_id" is null)
        or ("scope_kind" = 'template' and "template_id" is not null and "organization_id" is not null and "lobby_id" is null and "event_id" is null)
        or ("scope_kind" = 'lobby' and "lobby_id" is not null and "organization_id" is null and "template_id" is null and "event_id" is null)
        or ("scope_kind" = 'event' and "event_id" is not null and "lobby_id" is not null and "organization_id" is null and "template_id" is null)),
	CONSTRAINT "settings_one_tenant_key" CHECK (num_nonnulls("organization_id", "lobby_id") = 1),
	CONSTRAINT "settings_key_check" CHECK ("key" in ('pairing.preset', 'pairing.method', 'pairing.section_size', 'pairing.rematch', 'pairing.same_school', 'pairing.side_balance', 'pairing.side_alternation', 'pairing.pull_up', 'pairing.position_balance', 'pairing.section_repeat', 'pairing.preference_order', 'bye.recipient', 'bye.result', 'bye.repeat', 'judging.panel', 'judging.availability', 'judging.strike', 'judging.conflict', 'judging.same_school', 'judging.repeat_judge', 'judging.unsubmitted_ballot', 'judging.load_balance', 'judging.chair', 'judging.panel_same_school', 'judging.preference_order', 'standings.tiebreaks', 'standings.rating_ladder', 'break.line', 'break.seeding', 'break.double_qualifier', 'entry.divisions', 'entry.registration', 'entry.approval', 'entry.cap', 'conflict.handling', 'recording.capture', 'audience.posting', 'audience.decision', 'audience.scores', 'audience.reason', 'audience.feedback', 'audience.video', 'ballot.screening', 'resolution.rule', 'resolution.own_text', 'room.own_format', 'room.visibility', 'room.timing', 'room.floor', 'staff.minimum_band')),
	CONSTRAINT "settings_hold_check" CHECK ("hold" in ('default', 'enforced')),
	CONSTRAINT "settings_event_hold_is_default" CHECK ("scope_kind" <> 'event' or "hold" = 'default'),
	CONSTRAINT "settings_value_is_object" CHECK (jsonb_typeof("value") = 'object')
);
--> statement-breakpoint
CREATE TABLE "lobby_templates" (
	"lobby_id" text,
	"lobby_kind" text GENERATED ALWAYS AS ('standing') STORED NOT NULL,
	"template_id" text,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lobby_templates_pkey" PRIMARY KEY("lobby_id","template_id")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"format_id" text NOT NULL,
	"format_version" integer NOT NULL,
	"ballot_definition_id" text,
	"ballot_definition_version" integer,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "templates_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "templates_id_format_unique" UNIQUE("id","format_id","format_version"),
	CONSTRAINT "templates_ballot_definition_complete" CHECK (("ballot_definition_id" is null) = ("ballot_definition_version" is null)),
	CONSTRAINT "templates_name_nonempty" CHECK (length(trim("name")) > 0),
	CONSTRAINT "templates_version_positive" CHECK ("version" > 0),
	CONSTRAINT "templates_settings_version_positive" CHECK ("settings_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "judge_availability" (
	"tournament_judge_id" text,
	"time_slot_id" text,
	"lobby_id" text NOT NULL,
	"available" boolean NOT NULL,
	CONSTRAINT "judge_availability_pkey" PRIMARY KEY("tournament_judge_id","time_slot_id")
);
--> statement-breakpoint
CREATE TABLE "judge_events" (
	"tournament_judge_id" text,
	"event_id" text,
	"lobby_id" text NOT NULL,
	CONSTRAINT "judge_events_pkey" PRIMARY KEY("tournament_judge_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "judge_strikes" (
	"entry_id" text,
	"tournament_judge_id" text,
	"event_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_strikes_pkey" PRIMARY KEY("entry_id","tournament_judge_id"),
	CONSTRAINT "judge_strikes_source_check" CHECK ("source" in ('entry', 'judge', 'tab'))
);
--> statement-breakpoint
CREATE TABLE "tournament_judges" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"school_organization_id" text,
	"school_organization_kind" text GENERATED ALWAYS AS ('school') STORED NOT NULL,
	"status" text NOT NULL,
	"chair_qualified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tournament_judges_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "tournament_judges_actor_unique" UNIQUE("lobby_id","actor_id"),
	CONSTRAINT "tournament_judges_status_check" CHECK ("status" in ('invited', 'accepted', 'declined', 'removed')),
	CONSTRAINT "tournament_judges_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
-- Reference rows, hand-written (ADR 0018: literal cuid2 ids). They sit here,
-- between the new tables and the foreign keys below, because rows that
-- already exist reference them the moment those keys are added: every Room
-- takes Daisy's public lobby and every season Daisy by column default, and
-- every rating names one of Daisy's three ladders. Each INSERT targets a
-- table this migration created, so no existing row is rewritten.
--
-- Daisy is organization number one. It alone has no owner row: its owner is
-- the operator, outside the participant database (ADR 0043).
INSERT INTO "organizations" ("id", "kind", "name", "handle") VALUES
  ('fo05z182lha0a3usciy9wr2r', 'league', 'Daisy', 'daisy');
--> statement-breakpoint
INSERT INTO "lobbies" ("id", "kind", "owner_organization_id", "name", "handle") VALUES
  ('rhkgl9vjor1cmyr855wb62ku', 'standing', 'fo05z182lha0a3usciy9wr2r', 'Daisy', 'daisy');
--> statement-breakpoint
INSERT INTO "ladders" ("id", "lobby_id", "organization_id", "name") VALUES
  ('freestyle', 'rhkgl9vjor1cmyr855wb62ku', 'fo05z182lha0a3usciy9wr2r', 'Freestyle'),
  ('policy', 'rhkgl9vjor1cmyr855wb62ku', 'fo05z182lha0a3usciy9wr2r', 'Policy'),
  ('value', 'rhkgl9vjor1cmyr855wb62ku', 'fo05z182lha0a3usciy9wr2r', 'Value');
--> statement-breakpoint
-- Daisy's three templates, one per ladder, each pinning its standard format
-- at the revision current when this migration runs, with the Daisy ballot.
INSERT INTO "templates" ("id", "organization_id", "name", "format_id", "format_version")
SELECT seed.id, 'fo05z182lha0a3usciy9wr2r', f.name, f.id, f.current_version
FROM (VALUES
  ('s3tw1srulgcs6y2xhbog8gps', 'freestyle'),
  ('sp9twlusmhjkfsfuz0frjpv5', 'policy'),
  ('ctx489trsi8rxckjn6r9foi9', 'value')
) AS seed(id, format_id)
JOIN "formats" f ON f.id = seed.format_id;
--> statement-breakpoint
INSERT INTO "lobby_templates" ("lobby_id", "template_id")
SELECT 'rhkgl9vjor1cmyr855wb62ku', t.id FROM "templates" t
WHERE t.organization_id = 'fo05z182lha0a3usciy9wr2r';
--> statement-breakpoint
-- Daisy's preset roles, which every organization and host may give. Rank 1
-- is the highest. Director holds everything a league or host can give; Staff
-- runs rounds but sets no rules and makes no final release; Coach and
-- Assistant are a school's.
INSERT INTO "roles" ("id", "organization_id", "name", "rank", "preset") VALUES
  ('ruxofzpyiy993hn97bbxfewb', 'fo05z182lha0a3usciy9wr2r', 'Director', 1, true),
  ('lih2kkdou2a93bd7f8tgciko', 'fo05z182lha0a3usciy9wr2r', 'Staff', 2, true),
  ('ynnqj5ordd3xhead763g8u76', 'fo05z182lha0a3usciy9wr2r', 'Coach', 3, true),
  ('leukmm9g1odukc8vu94y8k1q', 'fo05z182lha0a3usciy9wr2r', 'Assistant', 4, true);
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "organization_id", "permission")
SELECT seed.role_id, 'fo05z182lha0a3usciy9wr2r', seed.permission
FROM (VALUES
  ('ruxofzpyiy993hn97bbxfewb', 'organization.manage'),
  ('ruxofzpyiy993hn97bbxfewb', 'organization.roles.manage'),
  ('ruxofzpyiy993hn97bbxfewb', 'lobby.setup.manage'),
  ('ruxofzpyiy993hn97bbxfewb', 'lobby.announce'),
  ('ruxofzpyiy993hn97bbxfewb', 'action_history.read'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.entries.manage'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.draw.edit'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.draw.publish'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.rooms.officiate'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.results.enter'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.results.release'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.ballots.read_unreleased'),
  ('ruxofzpyiy993hn97bbxfewb', 'tournament.resolutions.read_unreleased'),
  ('lih2kkdou2a93bd7f8tgciko', 'lobby.announce'),
  ('lih2kkdou2a93bd7f8tgciko', 'tournament.entries.manage'),
  ('lih2kkdou2a93bd7f8tgciko', 'tournament.draw.edit'),
  ('lih2kkdou2a93bd7f8tgciko', 'tournament.draw.publish'),
  ('lih2kkdou2a93bd7f8tgciko', 'tournament.rooms.officiate'),
  ('lih2kkdou2a93bd7f8tgciko', 'tournament.results.enter'),
  ('lih2kkdou2a93bd7f8tgciko', 'tournament.ballots.read_unreleased'),
  ('ynnqj5ordd3xhead763g8u76', 'school.roster.manage'),
  ('ynnqj5ordd3xhead763g8u76', 'school.ballots.read'),
  ('leukmm9g1odukc8vu94y8k1q', 'school.roster.manage')
) AS seed(role_id, permission);
--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD COLUMN "lobby_id" text;--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "ballot_definition_id" text;--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "ballot_definition_version" integer;--> statement-breakpoint
ALTER TABLE "formats" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "organization_id" text DEFAULT 'fo05z182lha0a3usciy9wr2r' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "lobby_id" text DEFAULT 'rhkgl9vjor1cmyr855wb62ku' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "lobby_kind" text DEFAULT 'standing' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "ballot_definition_id" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "ballot_definition_version" integer;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "host_actor_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "seasons_single_active";--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_single_active" ON "seasons" ("organization_id") WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_id_organization_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_id_lobby_unique" UNIQUE("id","lobby_id");--> statement-breakpoint
ALTER TABLE "agreement_signatures" DROP CONSTRAINT "agreement_signatures_once";--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_once" UNIQUE NULLS NOT DISTINCT("user_id","agreement","version","season_id","room_id","lobby_id");--> statement-breakpoint
CREATE INDEX "agreement_signatures_lobby_idx" ON "agreement_signatures" ("lobby_id");--> statement-breakpoint
CREATE INDEX "ballot_definition_versions_organization_idx" ON "ballot_definition_versions" ("ballot_definition_id","organization_id");--> statement-breakpoint
CREATE INDEX "ballot_definition_versions_lobby_idx" ON "ballot_definition_versions" ("ballot_definition_id","lobby_id");--> statement-breakpoint
CREATE INDEX "ballot_definitions_organization_idx" ON "ballot_definitions" ("organization_id");--> statement-breakpoint
CREATE INDEX "ballot_definitions_lobby_idx" ON "ballot_definitions" ("lobby_id");--> statement-breakpoint
CREATE INDEX "ballot_definitions_current_version_idx" ON "ballot_definitions" ("id","current_version");--> statement-breakpoint
CREATE INDEX "ballot_screenings_lobby_idx" ON "ballot_screenings" ("lobby_id","status");--> statement-breakpoint
CREATE INDEX "ballots_ballot_definition_idx" ON "ballots" ("ballot_definition_id","ballot_definition_version");--> statement-breakpoint
CREATE INDEX "certification_results_certification_idx" ON "certification_results" ("certification_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "certification_results_result_idx" ON "certification_results" ("result_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "certifications_event_idx" ON "certifications" ("event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "certifications_command_idx" ON "certifications" ("command_id","lobby_id");--> statement-breakpoint
CREATE INDEX "conflicts_fixture_idx" ON "conflicts" ("fixture_id","lobby_id");--> statement-breakpoint
CREATE INDEX "conflicts_user_idx" ON "conflicts" ("user_id");--> statement-breakpoint
CREATE INDEX "conflicts_confirmed_by_user_idx" ON "conflicts" ("confirmed_by_user_id");--> statement-breakpoint
CREATE INDEX "pending_commands_lobby_idx" ON "pending_commands" ("lobby_id","status");--> statement-breakpoint
CREATE INDEX "pending_commands_proposer_user_idx" ON "pending_commands" ("proposer_user_id");--> statement-breakpoint
CREATE INDEX "pending_commands_conflict_idx" ON "pending_commands" ("conflict_id","lobby_id");--> statement-breakpoint
CREATE INDEX "pending_commands_settled_by_user_idx" ON "pending_commands" ("settled_by_user_id");--> statement-breakpoint
CREATE INDEX "draw_fixtures_draw_idx" ON "draw_fixtures" ("draw_id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "draw_fixtures_fixture_idx" ON "draw_fixtures" ("fixture_id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "draw_result_inputs_draw_idx" ON "draw_result_inputs" ("draw_id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "draw_result_inputs_result_idx" ON "draw_result_inputs" ("result_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "draws_tab_round_idx" ON "draws" ("tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "draws_based_on_idx" ON "draws" ("based_on_draw_id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "entries_event_idx" ON "entries" ("event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "entries_school_idx" ON "entries" ("school_organization_id","school_organization_kind");--> statement-breakpoint
CREATE INDEX "entries_guardian_link_idx" ON "entries" ("guardian_link_id");--> statement-breakpoint
CREATE INDEX "entry_members_entry_idx" ON "entry_members" ("entry_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "entry_members_actor_idx" ON "entry_members" ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_name_unique" ON "events" ("lobby_id",lower("name"));--> statement-breakpoint
CREATE INDEX "events_format_revision_idx" ON "events" ("format_id","format_version");--> statement-breakpoint
CREATE INDEX "events_ballot_definition_idx" ON "events" ("ballot_definition_id","ballot_definition_version");--> statement-breakpoint
CREATE INDEX "events_template_idx" ON "events" ("template_id","format_id","format_version");--> statement-breakpoint
CREATE INDEX "stages_event_idx" ON "stages" ("event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "tab_rounds_stage_idx" ON "tab_rounds" ("stage_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "tab_rounds_time_slot_idx" ON "tab_rounds" ("time_slot_id","lobby_id");--> statement-breakpoint
CREATE INDEX "tab_rounds_resolution_pool_idx" ON "tab_rounds" ("resolution_pool_id");--> statement-breakpoint
CREATE INDEX "tab_rounds_pool_resolution_idx" ON "tab_rounds" ("pool_resolution_id","resolution_pool_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_slots_name_unique" ON "time_slots" ("lobby_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "fixture_entries_one_live_per_tab_round" ON "fixture_entries" ("tab_round_id","entry_id") WHERE "fixture_status" = 'published';--> statement-breakpoint
CREATE INDEX "fixture_entries_fixture_idx" ON "fixture_entries" ("fixture_id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "fixture_entries_fixture_status_idx" ON "fixture_entries" ("fixture_id","fixture_status");--> statement-breakpoint
CREATE INDEX "fixture_entries_entry_idx" ON "fixture_entries" ("entry_id","event_id","lobby_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixture_judges_one_live_per_tab_round" ON "fixture_judges" ("tab_round_id","tournament_judge_id") WHERE "fixture_status" = 'published';--> statement-breakpoint
CREATE INDEX "fixture_judges_fixture_idx" ON "fixture_judges" ("fixture_id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "fixture_judges_fixture_status_idx" ON "fixture_judges" ("fixture_id","fixture_status");--> statement-breakpoint
CREATE INDEX "fixture_judges_judge_idx" ON "fixture_judges" ("tournament_judge_id","lobby_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixtures_room_unique" ON "fixtures" ("room_id");--> statement-breakpoint
CREATE INDEX "fixtures_tab_round_idx" ON "fixtures" ("tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "fixtures_room_lobby_idx" ON "fixtures" ("room_id","lobby_id");--> statement-breakpoint
CREATE INDEX "formats_organization_idx" ON "formats" ("organization_id");--> statement-breakpoint
CREATE INDEX "action_history_organization_idx" ON "action_history" ("organization_id","applied_at");--> statement-breakpoint
CREATE INDEX "action_history_lobby_idx" ON "action_history" ("lobby_id","applied_at");--> statement-breakpoint
CREATE INDEX "action_history_actor_user_idx" ON "action_history" ("actor_user_id");--> statement-breakpoint
CREATE INDEX "action_history_grant_idx" ON "action_history" ("grant_id");--> statement-breakpoint
CREATE INDEX "action_history_conflict_idx" ON "action_history" ("conflict_id","lobby_id");--> statement-breakpoint
CREATE INDEX "action_history_aggregate_idx" ON "action_history" ("aggregate_kind","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_live_unique" ON "grants" ("user_id","role_id",coalesce("organization_id", "lobby_id")) WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "grants_role_idx" ON "grants" ("role_id");--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "grants" ("user_id");--> statement-breakpoint
CREATE INDEX "grants_membership_idx" ON "grants" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "grants_lobby_idx" ON "grants" ("lobby_id");--> statement-breakpoint
CREATE INDEX "grants_granted_by_user_idx" ON "grants" ("granted_by_user_id");--> statement-breakpoint
CREATE INDEX "grants_revoked_by_user_idx" ON "grants" ("revoked_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guardian_links_open_pair_unique" ON "guardian_links" ("guardian_user_id","minor_user_id") WHERE "status" <> 'ended';--> statement-breakpoint
CREATE INDEX "guardian_links_guardian_user_idx" ON "guardian_links" ("guardian_user_id");--> statement-breakpoint
CREATE INDEX "guardian_links_minor_user_idx" ON "guardian_links" ("minor_user_id");--> statement-breakpoint
CREATE INDEX "guardian_links_via_organization_idx" ON "guardian_links" ("via_organization_id","via_organization_kind");--> statement-breakpoint
CREATE INDEX "restriction_lobbies_restriction_idx" ON "restriction_lobbies" ("guardian_link_id","guardian_user_id","minor_user_id");--> statement-breakpoint
CREATE INDEX "restriction_lobbies_lobby_idx" ON "restriction_lobbies" ("lobby_id");--> statement-breakpoint
CREATE INDEX "ladders_lobby_organization_idx" ON "ladders" ("lobby_id","organization_id");--> statement-breakpoint
CREATE INDEX "ladders_lobby_kind_idx" ON "ladders" ("lobby_id","lobby_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "lobbies_handle_unique" ON "lobbies" (lower("handle"));--> statement-breakpoint
CREATE INDEX "lobbies_owner_user_idx" ON "lobbies" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "lobbies_owner_organization_idx" ON "lobbies" ("owner_organization_id","owner_organization_kind");--> statement-breakpoint
CREATE INDEX "tournaments_lobby_kind_idx" ON "tournaments" ("lobby_id","lobby_kind");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_handle_unique" ON "organizations" (lower("handle"));--> statement-breakpoint
CREATE INDEX "organizations_owner_user_idx" ON "organizations" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "organizations_billing_owner_user_idx" ON "organizations" ("billing_owner_user_id");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" ("role_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_unique" ON "roles" ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "rating_changes_ladder_idx" ON "rating_changes" ("ladder");--> statement-breakpoint
CREATE INDEX "ratings_ladder_idx" ON "ratings" ("ladder");--> statement-breakpoint
CREATE INDEX "seasons_organization_idx" ON "seasons" ("organization_id");--> statement-breakpoint
CREATE INDEX "releases_tab_round_idx" ON "releases" ("tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "releases_command_idx" ON "releases" ("command_id","lobby_id");--> statement-breakpoint
CREATE INDEX "releases_event_idx" ON "releases" ("event_id","thing","audience");--> statement-breakpoint
CREATE INDEX "pool_resolutions_pool_organization_idx" ON "pool_resolutions" ("pool_id","organization_id");--> statement-breakpoint
CREATE INDEX "pool_resolutions_pool_lobby_idx" ON "pool_resolutions" ("pool_id","lobby_id");--> statement-breakpoint
CREATE INDEX "resolution_pools_organization_idx" ON "resolution_pools" ("organization_id");--> statement-breakpoint
CREATE INDEX "resolution_pools_lobby_idx" ON "resolution_pools" ("lobby_id");--> statement-breakpoint
CREATE INDEX "resolution_pools_season_idx" ON "resolution_pools" ("season_id","organization_id");--> statement-breakpoint
CREATE INDEX "result_entries_result_idx" ON "result_entries" ("result_id","fixture_id","lobby_id");--> statement-breakpoint
CREATE INDEX "result_entries_fixture_entry_idx" ON "result_entries" ("fixture_id","entry_id");--> statement-breakpoint
CREATE INDEX "result_speakers_result_entry_idx" ON "result_speakers" ("result_id","entry_id","lobby_id");--> statement-breakpoint
CREATE INDEX "result_speakers_actor_idx" ON "result_speakers" ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "results_one_original_per_fixture" ON "results" ("fixture_id") WHERE "supersedes_result_id" is null;--> statement-breakpoint
CREATE INDEX "results_fixture_idx" ON "results" ("fixture_id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "results_fixture_status_idx" ON "results" ("fixture_id","fixture_status");--> statement-breakpoint
CREATE INDEX "results_round_idx" ON "results" ("round_id");--> statement-breakpoint
CREATE INDEX "results_supersedes_idx" ON "results" ("supersedes_result_id","fixture_id","lobby_id");--> statement-breakpoint
CREATE INDEX "results_command_idx" ON "results" ("command_id","lobby_id");--> statement-breakpoint
CREATE INDEX "results_event_idx" ON "results" ("event_id","recorded_at");--> statement-breakpoint
CREATE INDEX "rooms_lobby_kind_idx" ON "rooms" ("lobby_id","lobby_kind");--> statement-breakpoint
CREATE INDEX "rooms_lobby_template_idx" ON "rooms" ("lobby_id","template_id");--> statement-breakpoint
CREATE INDEX "rooms_ballot_definition_idx" ON "rooms" ("ballot_definition_id","ballot_definition_version");--> statement-breakpoint
CREATE INDEX "sanctions_league_idx" ON "sanctions" ("organization_id","organization_kind");--> statement-breakpoint
CREATE INDEX "sanctions_event_idx" ON "sanctions" ("event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "sanctions_season_idx" ON "sanctions" ("season_id","organization_id");--> statement-breakpoint
CREATE INDEX "sanctions_template_idx" ON "sanctions" ("template_id","organization_id");--> statement-breakpoint
CREATE INDEX "season_standing_rules_season_idx" ON "season_standing_rules" ("season_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settings_organization_key_unique" ON "settings" ("organization_id","key") WHERE "scope_kind" = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX "settings_template_key_unique" ON "settings" ("template_id","key") WHERE "scope_kind" = 'template';--> statement-breakpoint
CREATE UNIQUE INDEX "settings_lobby_key_unique" ON "settings" ("lobby_id","key") WHERE "scope_kind" = 'lobby';--> statement-breakpoint
CREATE UNIQUE INDEX "settings_event_key_unique" ON "settings" ("event_id","key") WHERE "scope_kind" = 'event';--> statement-breakpoint
CREATE INDEX "settings_organization_idx" ON "settings" ("organization_id");--> statement-breakpoint
CREATE INDEX "settings_lobby_idx" ON "settings" ("lobby_id");--> statement-breakpoint
CREATE INDEX "settings_template_idx" ON "settings" ("template_id","organization_id");--> statement-breakpoint
CREATE INDEX "settings_event_idx" ON "settings" ("event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "lobby_templates_lobby_kind_idx" ON "lobby_templates" ("lobby_id","lobby_kind");--> statement-breakpoint
CREATE INDEX "lobby_templates_template_idx" ON "lobby_templates" ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "templates_name_unique" ON "templates" ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "templates_format_revision_idx" ON "templates" ("format_id","format_version");--> statement-breakpoint
CREATE INDEX "templates_ballot_definition_idx" ON "templates" ("ballot_definition_id","ballot_definition_version");--> statement-breakpoint
CREATE INDEX "judge_availability_judge_idx" ON "judge_availability" ("tournament_judge_id","lobby_id");--> statement-breakpoint
CREATE INDEX "judge_availability_time_slot_idx" ON "judge_availability" ("time_slot_id","lobby_id");--> statement-breakpoint
CREATE INDEX "judge_events_judge_idx" ON "judge_events" ("tournament_judge_id","lobby_id");--> statement-breakpoint
CREATE INDEX "judge_events_event_idx" ON "judge_events" ("event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "judge_strikes_entry_idx" ON "judge_strikes" ("entry_id","event_id","lobby_id");--> statement-breakpoint
CREATE INDEX "judge_strikes_judge_idx" ON "judge_strikes" ("tournament_judge_id","lobby_id");--> statement-breakpoint
CREATE INDEX "tournament_judges_actor_idx" ON "tournament_judges" ("actor_id");--> statement-breakpoint
CREATE INDEX "tournament_judges_school_idx" ON "tournament_judges" ("school_organization_id","school_organization_kind");--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballot_definition_versions" ADD CONSTRAINT "ballot_definition_versions_organization_fk" FOREIGN KEY ("ballot_definition_id","organization_id") REFERENCES "ballot_definitions"("id","organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballot_definition_versions" ADD CONSTRAINT "ballot_definition_versions_lobby_fk" FOREIGN KEY ("ballot_definition_id","lobby_id") REFERENCES "ballot_definitions"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballot_definitions" ADD CONSTRAINT "ballot_definitions_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballot_definitions" ADD CONSTRAINT "ballot_definitions_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballot_definitions" ADD CONSTRAINT "ballot_definitions_current_version_fk" FOREIGN KEY ("id","current_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ballot_screenings" ADD CONSTRAINT "ballot_screenings_ballot_id_ballots_id_fkey" FOREIGN KEY ("ballot_id") REFERENCES "ballots"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ballot_screenings" ADD CONSTRAINT "ballot_screenings_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_ballot_definition_fk" FOREIGN KEY ("ballot_definition_id","ballot_definition_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "certification_results" ADD CONSTRAINT "certification_results_certification_fk" FOREIGN KEY ("certification_id","event_id","lobby_id") REFERENCES "certifications"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "certification_results" ADD CONSTRAINT "certification_results_result_fk" FOREIGN KEY ("result_id","event_id","lobby_id") REFERENCES "results"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_event_fk" FOREIGN KEY ("event_id","lobby_id") REFERENCES "events"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_command_fk" FOREIGN KEY ("command_id","lobby_id") REFERENCES "action_history"("command_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_confirmed_by_user_id_users_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_fixture_fk" FOREIGN KEY ("fixture_id","lobby_id") REFERENCES "fixtures"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_proposer_user_id_users_id_fkey" FOREIGN KEY ("proposer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_settled_by_user_id_users_id_fkey" FOREIGN KEY ("settled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_conflict_fk" FOREIGN KEY ("conflict_id","lobby_id") REFERENCES "conflicts"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "draw_fixtures" ADD CONSTRAINT "draw_fixtures_draw_fk" FOREIGN KEY ("draw_id","tab_round_id","event_id","lobby_id") REFERENCES "draws"("id","tab_round_id","event_id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "draw_fixtures" ADD CONSTRAINT "draw_fixtures_fixture_fk" FOREIGN KEY ("fixture_id","tab_round_id","event_id","lobby_id") REFERENCES "fixtures"("id","tab_round_id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "draw_result_inputs" ADD CONSTRAINT "draw_result_inputs_draw_fk" FOREIGN KEY ("draw_id","tab_round_id","event_id","lobby_id") REFERENCES "draws"("id","tab_round_id","event_id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "draw_result_inputs" ADD CONSTRAINT "draw_result_inputs_result_fk" FOREIGN KEY ("result_id","event_id","lobby_id") REFERENCES "results"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_tab_round_fk" FOREIGN KEY ("tab_round_id","event_id","lobby_id") REFERENCES "tab_rounds"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "draws" ADD CONSTRAINT "draws_based_on_fk" FOREIGN KEY ("based_on_draw_id","tab_round_id","event_id","lobby_id") REFERENCES "draws"("id","tab_round_id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_guardian_link_id_guardian_links_id_fkey" FOREIGN KEY ("guardian_link_id") REFERENCES "guardian_links"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_event_fk" FOREIGN KEY ("event_id","lobby_id") REFERENCES "events"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_school_fk" FOREIGN KEY ("school_organization_id","school_organization_kind") REFERENCES "organizations"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entry_members" ADD CONSTRAINT "entry_members_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entry_members" ADD CONSTRAINT "entry_members_entry_fk" FOREIGN KEY ("entry_id","event_id","lobby_id") REFERENCES "entries"("id","event_id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_lobby_id_tournaments_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_format_revision_fk" FOREIGN KEY ("format_id","format_version") REFERENCES "format_revisions"("format_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_ballot_definition_fk" FOREIGN KEY ("ballot_definition_id","ballot_definition_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_template_format_fk" FOREIGN KEY ("template_id","format_id","format_version") REFERENCES "templates"("id","format_id","format_version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "stages" ADD CONSTRAINT "stages_event_fk" FOREIGN KEY ("event_id","lobby_id") REFERENCES "events"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_resolution_pool_id_resolution_pools_id_fkey" FOREIGN KEY ("resolution_pool_id") REFERENCES "resolution_pools"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_stage_fk" FOREIGN KEY ("stage_id","event_id","lobby_id") REFERENCES "stages"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_time_slot_fk" FOREIGN KEY ("time_slot_id","lobby_id") REFERENCES "time_slots"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_pool_resolution_fk" FOREIGN KEY ("pool_resolution_id","resolution_pool_id") REFERENCES "pool_resolutions"("id","pool_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "time_slots" ADD CONSTRAINT "time_slots_lobby_id_tournaments_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fixture_entries" ADD CONSTRAINT "fixture_entries_fixture_fk" FOREIGN KEY ("fixture_id","tab_round_id","event_id","lobby_id") REFERENCES "fixtures"("id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
ALTER TABLE "fixture_entries" ADD CONSTRAINT "fixture_entries_fixture_status_fk" FOREIGN KEY ("fixture_id","fixture_status") REFERENCES "fixtures"("id","status") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "fixture_entries" ADD CONSTRAINT "fixture_entries_entry_fk" FOREIGN KEY ("entry_id","event_id","lobby_id") REFERENCES "entries"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fixture_judges" ADD CONSTRAINT "fixture_judges_fixture_fk" FOREIGN KEY ("fixture_id","tab_round_id","event_id","lobby_id") REFERENCES "fixtures"("id","tab_round_id","event_id","lobby_id");--> statement-breakpoint
ALTER TABLE "fixture_judges" ADD CONSTRAINT "fixture_judges_fixture_status_fk" FOREIGN KEY ("fixture_id","fixture_status") REFERENCES "fixtures"("id","status") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "fixture_judges" ADD CONSTRAINT "fixture_judges_judge_fk" FOREIGN KEY ("tournament_judge_id","lobby_id") REFERENCES "tournament_judges"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_tab_round_fk" FOREIGN KEY ("tab_round_id","event_id","lobby_id") REFERENCES "tab_rounds"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fixtures" ADD CONSTRAINT "fixtures_room_fk" FOREIGN KEY ("room_id","lobby_id") REFERENCES "rooms"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "formats" ADD CONSTRAINT "formats_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_actor_user_id_users_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_grant_id_grants_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "grants"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_conflict_fk" FOREIGN KEY ("conflict_id","lobby_id") REFERENCES "conflicts"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_role_id_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_user_id_users_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_revoked_by_user_id_users_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_membership_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "memberships"("organization_id","user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_guardian_user_id_users_id_fkey" FOREIGN KEY ("guardian_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_minor_user_id_users_id_fkey" FOREIGN KEY ("minor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "guardian_links" ADD CONSTRAINT "guardian_links_via_school_fk" FOREIGN KEY ("via_organization_id","via_organization_kind") REFERENCES "organizations"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ADD CONSTRAINT "restriction_lobbies_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ADD CONSTRAINT "restriction_lobbies_restriction_fk" FOREIGN KEY ("guardian_link_id","guardian_user_id","minor_user_id") REFERENCES "restrictions"("guardian_link_id","guardian_user_id","minor_user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_guardian_link_fk" FOREIGN KEY ("guardian_link_id","guardian_user_id","minor_user_id") REFERENCES "guardian_links"("id","guardian_user_id","minor_user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ladders" ADD CONSTRAINT "ladders_lobby_owner_fk" FOREIGN KEY ("lobby_id","organization_id") REFERENCES "lobbies"("id","owner_organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ladders" ADD CONSTRAINT "ladders_standing_lobby_fk" FOREIGN KEY ("lobby_id","lobby_kind") REFERENCES "lobbies"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_owner_league_fk" FOREIGN KEY ("owner_organization_id","owner_organization_kind") REFERENCES "organizations"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_tournament_lobby_fk" FOREIGN KEY ("lobby_id","lobby_kind") REFERENCES "lobbies"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_billing_owner_user_id_users_id_fkey" FOREIGN KEY ("billing_owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("role_id","organization_id") REFERENCES "roles"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_ladder_ladders_id_fkey" FOREIGN KEY ("ladder") REFERENCES "ladders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ladder_ladders_id_fkey" FOREIGN KEY ("ladder") REFERENCES "ladders"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_tab_round_fk" FOREIGN KEY ("tab_round_id","event_id","lobby_id") REFERENCES "tab_rounds"("id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_command_fk" FOREIGN KEY ("command_id","lobby_id") REFERENCES "action_history"("command_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pool_resolutions" ADD CONSTRAINT "pool_resolutions_organization_pool_fk" FOREIGN KEY ("pool_id","organization_id") REFERENCES "resolution_pools"("id","organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "pool_resolutions" ADD CONSTRAINT "pool_resolutions_lobby_pool_fk" FOREIGN KEY ("pool_id","lobby_id") REFERENCES "resolution_pools"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resolution_pools" ADD CONSTRAINT "resolution_pools_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resolution_pools" ADD CONSTRAINT "resolution_pools_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resolution_pools" ADD CONSTRAINT "resolution_pools_season_fk" FOREIGN KEY ("season_id","organization_id") REFERENCES "seasons"("id","organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "result_entries" ADD CONSTRAINT "result_entries_result_fk" FOREIGN KEY ("result_id","fixture_id","lobby_id") REFERENCES "results"("id","fixture_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "result_entries" ADD CONSTRAINT "result_entries_fixture_entry_fk" FOREIGN KEY ("fixture_id","entry_id") REFERENCES "fixture_entries"("fixture_id","entry_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "result_speakers" ADD CONSTRAINT "result_speakers_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "result_speakers" ADD CONSTRAINT "result_speakers_result_entry_fk" FOREIGN KEY ("result_id","entry_id","lobby_id") REFERENCES "result_entries"("result_id","entry_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_fixture_fk" FOREIGN KEY ("fixture_id","tab_round_id","event_id","lobby_id") REFERENCES "fixtures"("id","tab_round_id","event_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_live_fixture_fk" FOREIGN KEY ("fixture_id","fixture_status") REFERENCES "fixtures"("id","status");--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_supersedes_fk" FOREIGN KEY ("supersedes_result_id","fixture_id","lobby_id") REFERENCES "results"("id","fixture_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_command_fk" FOREIGN KEY ("command_id","lobby_id") REFERENCES "action_history"("command_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_lobby_fk" FOREIGN KEY ("lobby_id","lobby_kind") REFERENCES "lobbies"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_offered_template_fk" FOREIGN KEY ("lobby_id","template_id") REFERENCES "lobby_templates"("lobby_id","template_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_ballot_definition_fk" FOREIGN KEY ("ballot_definition_id","ballot_definition_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_league_fk" FOREIGN KEY ("organization_id","organization_kind") REFERENCES "organizations"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_event_fk" FOREIGN KEY ("event_id","lobby_id") REFERENCES "events"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_season_fk" FOREIGN KEY ("season_id","organization_id") REFERENCES "seasons"("id","organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_template_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "templates"("id","organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "season_standing_rules" ADD CONSTRAINT "season_standing_rules_season_fk" FOREIGN KEY ("season_id","organization_id") REFERENCES "seasons"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_template_fk" FOREIGN KEY ("template_id","organization_id") REFERENCES "templates"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_event_fk" FOREIGN KEY ("event_id","lobby_id") REFERENCES "events"("id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lobby_templates" ADD CONSTRAINT "lobby_templates_template_id_templates_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "lobby_templates" ADD CONSTRAINT "lobby_templates_standing_lobby_fk" FOREIGN KEY ("lobby_id","lobby_kind") REFERENCES "lobbies"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_format_revision_fk" FOREIGN KEY ("format_id","format_version") REFERENCES "format_revisions"("format_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_ballot_definition_fk" FOREIGN KEY ("ballot_definition_id","ballot_definition_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "judge_availability" ADD CONSTRAINT "judge_availability_judge_fk" FOREIGN KEY ("tournament_judge_id","lobby_id") REFERENCES "tournament_judges"("id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "judge_availability" ADD CONSTRAINT "judge_availability_time_slot_fk" FOREIGN KEY ("time_slot_id","lobby_id") REFERENCES "time_slots"("id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "judge_events" ADD CONSTRAINT "judge_events_judge_fk" FOREIGN KEY ("tournament_judge_id","lobby_id") REFERENCES "tournament_judges"("id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "judge_events" ADD CONSTRAINT "judge_events_event_fk" FOREIGN KEY ("event_id","lobby_id") REFERENCES "events"("id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "judge_strikes" ADD CONSTRAINT "judge_strikes_entry_fk" FOREIGN KEY ("entry_id","event_id","lobby_id") REFERENCES "entries"("id","event_id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "judge_strikes" ADD CONSTRAINT "judge_strikes_judge_fk" FOREIGN KEY ("tournament_judge_id","lobby_id") REFERENCES "tournament_judges"("id","lobby_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tournament_judges" ADD CONSTRAINT "tournament_judges_lobby_id_tournaments_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_judges" ADD CONSTRAINT "tournament_judges_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_judges" ADD CONSTRAINT "tournament_judges_school_fk" FOREIGN KEY ("school_organization_id","school_organization_kind") REFERENCES "organizations"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_ballot_definition_complete" CHECK (("ballot_definition_id" is null) = ("ballot_definition_version" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "formats" ADD CONSTRAINT "formats_one_owner_at_most" CHECK ("organization_id" is null or ("created_by_actor_id" is null and "catalog_role" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_by_lobby_kind" CHECK (("host_actor_id" is null) = ("lobby_kind" = 'tournament')) NOT VALID;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_event_is_casual" CHECK ("lobby_kind" <> 'tournament' or "competition_type" = 'casual') NOT VALID;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_ballot_definition_complete" CHECK (("ballot_definition_id" is null) = ("ballot_definition_version" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "agreement_signatures" DROP CONSTRAINT "agreement_signatures_agreement_check", ADD CONSTRAINT "agreement_signatures_agreement_check" CHECK ("agreement" in ('ranked-content-waiver', 'round-capture-notice', 'tournament-recording-consent'));--> statement-breakpoint
ALTER TABLE "agreement_signatures" DROP CONSTRAINT "agreement_signatures_scope_check", ADD CONSTRAINT "agreement_signatures_scope_check" CHECK (("agreement" = 'ranked-content-waiver' and "season_id" is not null and "room_id" is null and "lobby_id" is null)
        or ("agreement" = 'round-capture-notice' and "room_id" is not null and "season_id" is null and "lobby_id" is null)
        or ("agreement" = 'tournament-recording-consent' and "lobby_id" is not null and "season_id" is null and "room_id" is null));
--> statement-breakpoint
-- Everything below is hand-written (docs/operations/database.md).
--
-- Tenant scope. A transaction's scope is three transaction-local settings,
-- set only by withScope in @daisy/db after authorize has allowed the
-- operation. With none set each function is null, so every policy predicate
-- is null and no fenced row is visible or writable: the fence fails closed.
CREATE FUNCTION public.daisy_organization_scope() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
AS $organization_scope$ SELECT nullif(current_setting('daisy.organization_scope', true), '') $organization_scope$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_lobby_scope() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
AS $lobby_scope$ SELECT nullif(current_setting('daisy.lobby_scope', true), '') $lobby_scope$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_subject_scope() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog
AS $subject_scope$ SELECT nullif(current_setting('daisy.subject_scope', true), '') $subject_scope$;
--> statement-breakpoint
-- The subject's actor, for rows keyed by actor. Invoker's rights: it reads
-- actors, which is not a tenant table.
CREATE FUNCTION public.daisy_subject_actor_scope() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $subject_actor_scope$
  SELECT a.id FROM public.actors a
  WHERE a.user_id = nullif(current_setting('daisy.subject_scope', true), '')
$subject_actor_scope$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_organization_scope(), public.daisy_lobby_scope(),
  public.daisy_subject_scope(), public.daisy_subject_actor_scope() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_organization_scope(), public.daisy_lobby_scope(),
  public.daisy_subject_scope(), public.daisy_subject_actor_scope() TO daisy_web;
--> statement-breakpoint
-- Row-level security: the statements `bun packages/db/scripts/tenant-policies.ts`
-- prints from the manifest (packages/db/src/tenant-isolation-manifest.ts).
-- ENABLE, not FORCE: the migration owner keeps access for migrations and
-- fixtures; the runtime roles own no table, so the policies bind them.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "organizations_scope" ON "organizations" FOR ALL USING (id = daisy_organization_scope()) WITH CHECK (id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "organizations_open_read" ON "organizations" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "memberships_scope" ON "memberships" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "memberships_subject" ON "memberships" FOR SELECT USING (user_id = daisy_subject_scope());
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roles_scope" ON "roles" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "role_permissions_scope" ON "role_permissions" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
ALTER TABLE "grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "grants_scope" ON "grants" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
CREATE POLICY "grants_subject" ON "grants" FOR SELECT USING (user_id = daisy_subject_scope());
--> statement-breakpoint
ALTER TABLE "guardian_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "guardian_links_subject" ON "guardian_links" FOR SELECT USING ((guardian_user_id = daisy_subject_scope()) OR (minor_user_id = daisy_subject_scope()));
--> statement-breakpoint
ALTER TABLE "restrictions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "restrictions_subject" ON "restrictions" FOR SELECT USING ((guardian_user_id = daisy_subject_scope()) OR (minor_user_id = daisy_subject_scope()));
--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "restriction_lobbies_subject" ON "restriction_lobbies" FOR SELECT USING ((guardian_user_id = daisy_subject_scope()) OR (minor_user_id = daisy_subject_scope()));
--> statement-breakpoint
ALTER TABLE "action_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "action_history_scope" ON "action_history" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
ALTER TABLE "lobbies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lobbies_scope" ON "lobbies" FOR ALL USING (id = daisy_lobby_scope()) WITH CHECK (id = daisy_lobby_scope());
--> statement-breakpoint
CREATE POLICY "lobbies_open_read" ON "lobbies" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "templates_scope" ON "templates" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "templates_open_read" ON "templates" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "lobby_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "lobby_templates_scope" ON "lobby_templates" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "settings_scope" ON "settings" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
CREATE POLICY "settings_open_read" ON "settings" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "ladders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ladders_scope" ON "ladders" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "ladders_open_read" ON "ladders" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tournaments_scope" ON "tournaments" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
CREATE POLICY "tournaments_open_read" ON "tournaments" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "events_scope" ON "events" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "stages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "stages_scope" ON "stages" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "time_slots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "time_slots_scope" ON "time_slots" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "tab_rounds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tab_rounds_scope" ON "tab_rounds" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "entries_scope" ON "entries" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "entry_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "entry_members_scope" ON "entry_members" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
CREATE POLICY "entry_members_subject" ON "entry_members" FOR SELECT USING (actor_id = daisy_subject_actor_scope());
--> statement-breakpoint
ALTER TABLE "tournament_judges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tournament_judges_scope" ON "tournament_judges" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
CREATE POLICY "tournament_judges_subject" ON "tournament_judges" FOR SELECT USING (actor_id = daisy_subject_actor_scope());
--> statement-breakpoint
ALTER TABLE "judge_availability" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "judge_availability_scope" ON "judge_availability" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "judge_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "judge_events_scope" ON "judge_events" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "judge_strikes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "judge_strikes_scope" ON "judge_strikes" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "resolution_pools" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "resolution_pools_scope" ON "resolution_pools" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
ALTER TABLE "pool_resolutions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "pool_resolutions_scope" ON "pool_resolutions" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
ALTER TABLE "draws" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "draws_scope" ON "draws" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "draw_result_inputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "draw_result_inputs_scope" ON "draw_result_inputs" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "draw_fixtures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "draw_fixtures_scope" ON "draw_fixtures" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "fixtures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "fixtures_scope" ON "fixtures" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "fixture_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "fixture_entries_scope" ON "fixture_entries" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "fixture_judges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "fixture_judges_scope" ON "fixture_judges" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "conflicts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "conflicts_scope" ON "conflicts" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "pending_commands" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "pending_commands_scope" ON "pending_commands" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "ballot_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ballot_definitions_scope" ON "ballot_definitions" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
CREATE POLICY "ballot_definitions_open_read" ON "ballot_definitions" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "ballot_definition_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ballot_definition_versions_scope" ON "ballot_definition_versions" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
CREATE POLICY "ballot_definition_versions_open_read" ON "ballot_definition_versions" FOR SELECT USING (true);
--> statement-breakpoint
ALTER TABLE "results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "results_scope" ON "results" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "result_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "result_entries_scope" ON "result_entries" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "result_speakers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "result_speakers_scope" ON "result_speakers" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "certifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "certifications_scope" ON "certifications" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "certification_results" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "certification_results_scope" ON "certification_results" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "releases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "releases_scope" ON "releases" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "ballot_screenings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ballot_screenings_scope" ON "ballot_screenings" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
ALTER TABLE "sanctions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sanctions_scope" ON "sanctions" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope())) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()));
--> statement-breakpoint
ALTER TABLE "season_standing_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "season_standing_rules_scope" ON "season_standing_rules" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
-- What happened is append-only: action history, results and what they gave,
-- certifications, releases, conflicts and ballot definition versions. A
-- trigger refuses UPDATE and DELETE for every role, and the runtime role
-- holds neither privilege.
CREATE FUNCTION public.daisy_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $refuse_change$
BEGIN
  RAISE EXCEPTION '% rows are never changed or deleted', TG_TABLE_NAME
    USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_append_only';
END;
$refuse_change$;
--> statement-breakpoint
CREATE TRIGGER action_history_append_only BEFORE UPDATE OR DELETE ON "action_history"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER results_append_only BEFORE UPDATE OR DELETE ON "results"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER result_entries_append_only BEFORE UPDATE OR DELETE ON "result_entries"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER result_speakers_append_only BEFORE UPDATE OR DELETE ON "result_speakers"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER certifications_append_only BEFORE UPDATE OR DELETE ON "certifications"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER certification_results_append_only BEFORE UPDATE OR DELETE ON "certification_results"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER releases_append_only BEFORE UPDATE OR DELETE ON "releases"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER conflicts_append_only BEFORE UPDATE OR DELETE ON "conflicts"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER ballot_definition_versions_append_only BEFORE UPDATE OR DELETE ON "ballot_definition_versions"
FOR EACH ROW EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
-- TRUNCATE passes row triggers, so a statement trigger refuses it too.
CREATE TRIGGER action_history_never_truncated BEFORE TRUNCATE ON "action_history"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER results_never_truncated BEFORE TRUNCATE ON "results"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER result_entries_never_truncated BEFORE TRUNCATE ON "result_entries"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER result_speakers_never_truncated BEFORE TRUNCATE ON "result_speakers"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER certifications_never_truncated BEFORE TRUNCATE ON "certifications"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER certification_results_never_truncated BEFORE TRUNCATE ON "certification_results"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER releases_never_truncated BEFORE TRUNCATE ON "releases"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER conflicts_never_truncated BEFORE TRUNCATE ON "conflicts"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
CREATE TRIGGER ballot_definition_versions_never_truncated BEFORE TRUNCATE ON "ballot_definition_versions"
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_refuse_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "action_history", "results", "result_entries", "result_speakers",
  "certifications", "certification_results", "releases", "conflicts",
  "ballot_definition_versions" FROM daisy_web;
--> statement-breakpoint
-- A grant is revoked once and never otherwise changed or deleted, so action
-- history that names it always resolves.
CREATE FUNCTION public.daisy_guard_grant() RETURNS trigger
LANGUAGE plpgsql AS $guard_grant$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A grant is revoked, never deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'grants_never_deleted';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
    OR (NEW.id, NEW.role_id, NEW.user_id, NEW.scope_kind, NEW.organization_id,
        NEW.lobby_id, NEW.granted_by_user_id, NEW.granted_at, NEW.expires_at)
      IS DISTINCT FROM
       (OLD.id, OLD.role_id, OLD.user_id, OLD.scope_kind, OLD.organization_id,
        OLD.lobby_id, OLD.granted_by_user_id, OLD.granted_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'The only change to a grant is its one revocation'
      USING ERRCODE = '23514', CONSTRAINT = 'grants_only_revoked';
  END IF;
  RETURN NEW;
END;
$guard_grant$;
--> statement-breakpoint
CREATE TRIGGER grants_guard BEFORE UPDATE OR DELETE ON "grants"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_grant();
--> statement-breakpoint
REVOKE DELETE ON "grants" FROM daisy_web;
--> statement-breakpoint
-- A template's pins never change: a different format or ballot is a new
-- template. Only its name, retirement and counters are edited.
CREATE FUNCTION public.daisy_guard_template_pins() RETURNS trigger
LANGUAGE plpgsql AS $guard_template_pins$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.format_id, NEW.format_version,
      NEW.ballot_definition_id, NEW.ballot_definition_version)
    IS DISTINCT FROM
     (OLD.id, OLD.organization_id, OLD.format_id, OLD.format_version,
      OLD.ballot_definition_id, OLD.ballot_definition_version) THEN
    RAISE EXCEPTION 'A template keeps its organization, format and ballot definition'
      USING ERRCODE = '23514', CONSTRAINT = 'templates_pins_immutable';
  END IF;
  RETURN NEW;
END;
$guard_template_pins$;
--> statement-breakpoint
CREATE TRIGGER templates_pins_immutable BEFORE UPDATE ON "templates"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_template_pins();
--> statement-breakpoint
-- A pool resolution's wording never changes; it is retired instead.
CREATE FUNCTION public.daisy_guard_pool_resolution() RETURNS trigger
LANGUAGE plpgsql AS $guard_pool_resolution$
BEGIN
  IF (NEW.id, NEW.pool_id, NEW.organization_id, NEW.lobby_id, NEW.text)
    IS DISTINCT FROM
     (OLD.id, OLD.pool_id, OLD.organization_id, OLD.lobby_id, OLD.text) THEN
    RAISE EXCEPTION 'A pool resolution keeps its pool and its wording'
      USING ERRCODE = '23514', CONSTRAINT = 'pool_resolutions_wording_immutable';
  END IF;
  RETURN NEW;
END;
$guard_pool_resolution$;
--> statement-breakpoint
CREATE TRIGGER pool_resolutions_wording_immutable BEFORE UPDATE ON "pool_resolutions"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_pool_resolution();
--> statement-breakpoint
-- A published draw is fixed: its row, the fixtures it holds and the results
-- it was computed from.
CREATE FUNCTION public.daisy_guard_published_draw() RETURNS trigger
LANGUAGE plpgsql AS $guard_published_draw$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'A published draw is never changed or deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'draws_published_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$guard_published_draw$;
--> statement-breakpoint
CREATE TRIGGER draws_published_immutable BEFORE UPDATE OR DELETE ON "draws"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_published_draw();
--> statement-breakpoint
CREATE FUNCTION public.daisy_guard_published_draw_list() RETURNS trigger
LANGUAGE plpgsql AS $guard_published_draw_list$
DECLARE
  published boolean;
BEGIN
  -- The draw row is locked, so a write that races a publish waits for it
  -- and then reads the status the publish committed.
  SELECT bool_or(locked.status = 'published') INTO published
  FROM (
    SELECT d.status FROM public.draws d
    WHERE d.id IN (
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.draw_id END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.draw_id END)
    FOR SHARE
  ) locked;
  IF published THEN
    RAISE EXCEPTION 'What a published draw holds is never changed'
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_published_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$guard_published_draw_list$;
--> statement-breakpoint
CREATE TRIGGER draw_fixtures_published_immutable BEFORE INSERT OR UPDATE OR DELETE ON "draw_fixtures"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_published_draw_list();
--> statement-breakpoint
CREATE TRIGGER draw_result_inputs_published_immutable BEFORE INSERT OR UPDATE OR DELETE ON "draw_result_inputs"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_published_draw_list();
--> statement-breakpoint
-- A fixture has one identity for life. Its status moves only from draft to
-- published to withdrawn; once published its tab round and kind are fixed
-- and it is never deleted.
CREATE FUNCTION public.daisy_guard_fixture() RETURNS trigger
LANGUAGE plpgsql AS $guard_fixture$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'A published fixture is withdrawn, never deleted'
        USING ERRCODE = '23514', CONSTRAINT = 'fixtures_published_never_deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.status <> OLD.status
    AND NOT (OLD.status = 'draft' AND NEW.status = 'published')
    AND NOT (OLD.status = 'published' AND NEW.status = 'withdrawn') THEN
    RAISE EXCEPTION 'A fixture moves only from draft to published to withdrawn'
      USING ERRCODE = '23514', CONSTRAINT = 'fixtures_status_forward_only';
  END IF;
  IF OLD.status <> 'draft'
    AND (NEW.id, NEW.lobby_id, NEW.event_id, NEW.tab_round_id, NEW.kind)
      IS DISTINCT FROM (OLD.id, OLD.lobby_id, OLD.event_id, OLD.tab_round_id, OLD.kind) THEN
    RAISE EXCEPTION 'A published fixture keeps its tab round and its kind'
      USING ERRCODE = '23514', CONSTRAINT = 'fixtures_published_identity_immutable';
  END IF;
  RETURN NEW;
END;
$guard_fixture$;
--> statement-breakpoint
CREATE TRIGGER fixtures_guard BEFORE UPDATE OR DELETE ON "fixtures"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_fixture();
--> statement-breakpoint
-- Who meets whom never changes on a published fixture. The one write that
-- passes is the cascade that keeps fixture_status equal to the fixture's.
CREATE FUNCTION public.daisy_guard_fixture_entry() RETURNS trigger
LANGUAGE plpgsql AS $guard_fixture_entry$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.fixture_status = 'draft' THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.fixture_status = 'draft' THEN RETURN OLD; END IF;
  -- A draft row may change while it stays a draft fixture's; any other
  -- update must leave who meets whom as it was, which is the cascade.
  ELSIF (OLD.fixture_status = 'draft' AND NEW.fixture_status = 'draft')
    OR (NEW.fixture_id, NEW.entry_id, NEW."position", NEW.side,
        NEW.tab_round_id, NEW.event_id, NEW.lobby_id)
      IS NOT DISTINCT FROM
       (OLD.fixture_id, OLD.entry_id, OLD."position", OLD.side,
        OLD.tab_round_id, OLD.event_id, OLD.lobby_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The entries and sides of a published fixture are fixed'
    USING ERRCODE = '23514', CONSTRAINT = 'fixture_entries_fixed_once_published';
END;
$guard_fixture_entry$;
--> statement-breakpoint
CREATE TRIGGER fixture_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON "fixture_entries"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_fixture_entry();
--> statement-breakpoint
-- A held command is stored whole and settled at most once.
CREATE FUNCTION public.daisy_guard_pending_command() RETURNS trigger
LANGUAGE plpgsql AS $guard_pending_command$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A held command is settled, never deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'pending_commands_never_deleted';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'A held command is settled at most once'
      USING ERRCODE = '23514', CONSTRAINT = 'pending_commands_settled_once';
  END IF;
  IF (NEW.command_id, NEW.lobby_id, NEW.proposer_user_id, NEW.type, NEW.payload,
      NEW.payload_digest, NEW.expected, NEW.conflict_id, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM
     (OLD.command_id, OLD.lobby_id, OLD.proposer_user_id, OLD.type, OLD.payload,
      OLD.payload_digest, OLD.expected, OLD.conflict_id, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'A held command is stored whole'
      USING ERRCODE = '23514', CONSTRAINT = 'pending_commands_stored_whole';
  END IF;
  RETURN NEW;
END;
$guard_pending_command$;
--> statement-breakpoint
CREATE TRIGGER pending_commands_guard BEFORE UPDATE OR DELETE ON "pending_commands"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_pending_command();
--> statement-breakpoint
REVOKE DELETE ON "pending_commands" FROM daisy_web;
--> statement-breakpoint
-- Guardian links and restrictions are closed: no minor's data is held until
-- counsel answers. The runtime role can read its own rows and write none; a
-- later migration opens them.
REVOKE INSERT, UPDATE, DELETE ON "guardian_links", "restrictions", "restriction_lobbies" FROM daisy_web;
