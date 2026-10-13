-- The tables Darkbeacon reads from a Wanderer database, as our Wanderer fork creates them: the
-- CREATE TABLE statements of pg_dump --schema-only on a migrated fork, the schema prefix removed so
-- a test can create them in a throwaway schema. Keys, indexes and foreign keys are left out.

CREATE TABLE access_list_members_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    eve_character_id text,
    eve_corporation_id text,
    eve_alliance_id text,
    role text DEFAULT 'viewer'::text,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    access_list_id uuid
);

CREATE TABLE access_lists_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    owner_id uuid,
    api_key text
);

CREATE TABLE character_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    eve_id text NOT NULL,
    name text NOT NULL,
    online boolean DEFAULT false,
    scopes text,
    character_owner_hash text,
    token_type text,
    expires_at bigint,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    user_id uuid,
    deleted boolean DEFAULT false,
    corporation_id bigint,
    corporation_name text,
    corporation_ticker text,
    alliance_id bigint,
    alliance_name text,
    alliance_ticker text,
    ship_name text,
    encrypted_eve_wallet_balance bytea,
    encrypted_location bytea,
    encrypted_ship bytea,
    encrypted_solar_system_id bytea,
    encrypted_structure_id bytea,
    encrypted_access_token bytea,
    encrypted_refresh_token bytea,
    encrypted_station_id bytea,
    ship_item_id bigint,
    tracking_pool text,
    description text
);

CREATE TABLE map_access_lists_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    map_id uuid NOT NULL,
    access_list_id uuid NOT NULL
);

CREATE TABLE map_chain_passages_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ship_type_id bigint,
    solar_system_source_id bigint,
    solar_system_target_id bigint,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    map_id uuid NOT NULL,
    character_id uuid NOT NULL,
    ship_name text,
    mass bigint
);

CREATE TABLE map_chain_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    solar_system_source bigint,
    solar_system_target bigint,
    mass_status bigint DEFAULT 0,
    time_status bigint DEFAULT 0,
    ship_size_type bigint DEFAULT 2,
    wormhole_type text,
    count_of_passage bigint DEFAULT 0,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    map_id uuid,
    locked boolean,
    custom_info text,
    type bigint DEFAULT 0,
    locked_by_id uuid,
    locked_at timestamp without time zone,
    dangerous boolean DEFAULT false NOT NULL,
    bubbled bigint DEFAULT 0 NOT NULL,
    mass_status_updated_at timestamp without time zone
);

CREATE TABLE map_character_settings_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tracked boolean DEFAULT false,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    map_id uuid NOT NULL,
    character_id uuid NOT NULL,
    followed boolean DEFAULT false,
    encrypted_ship bytea,
    encrypted_ship_name bytea,
    encrypted_ship_item_id bytea,
    encrypted_solar_system_id bytea,
    encrypted_structure_id bytea,
    encrypted_station_id bytea
);

CREATE TABLE map_system_comments_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    text text NOT NULL,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    system_id uuid,
    character_id uuid
);

CREATE TABLE map_system_signatures_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    eve_id text NOT NULL,
    name text,
    description text,
    kind text,
    "group" text,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    system_id uuid,
    character_eve_id text NOT NULL,
    linked_system_id bigint,
    type text,
    custom_info text,
    deleted boolean DEFAULT false NOT NULL,
    update_forced_at timestamp(0) without time zone,
    temporary_name text
);

CREATE TABLE map_system_structures_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    structure_type_id text NOT NULL,
    structure_type text NOT NULL,
    character_eve_id text NOT NULL,
    solar_system_name text NOT NULL,
    solar_system_id bigint NOT NULL,
    name text NOT NULL,
    notes text,
    owner_name text,
    owner_ticker text,
    owner_id text,
    status text,
    end_time timestamp without time zone,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    system_id uuid
);

CREATE TABLE map_system_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    solar_system_id bigint NOT NULL,
    name text NOT NULL,
    custom_name text,
    description text,
    tag text,
    labels text,
    status bigint DEFAULT 0,
    visible boolean DEFAULT true,
    locked boolean DEFAULT false,
    position_x bigint DEFAULT 0,
    position_y bigint DEFAULT 0,
    added_at timestamp(0) without time zone,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    map_id uuid,
    temporary_name text,
    linked_sig_eve_id text
);

CREATE TABLE map_user_settings_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    settings text,
    map_id uuid NOT NULL,
    user_id uuid NOT NULL,
    hubs text[] DEFAULT ARRAY[]::text[],
    main_character_eve_id text,
    following_character_eve_id text
);

CREATE TABLE map_webhook_subscriptions_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    map_id uuid NOT NULL,
    url text NOT NULL,
    events text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "active?" boolean DEFAULT true NOT NULL,
    last_delivery_at timestamp(0) without time zone,
    last_error text,
    last_error_at timestamp(0) without time zone,
    consecutive_failures bigint DEFAULT 0 NOT NULL,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    encrypted_secret bytea NOT NULL
);

CREATE TABLE maps_v1 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    description text,
    personal_note text,
    hubs text[] DEFAULT ARRAY[]::text[],
    owner_id uuid,
    deleted boolean DEFAULT false,
    inserted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    slug text NOT NULL,
    scope text DEFAULT 'wormholes'::text NOT NULL,
    only_tracked_characters boolean DEFAULT false,
    options text,
    public_api_key text,
    webhooks_enabled boolean DEFAULT false NOT NULL,
    sse_enabled boolean DEFAULT false NOT NULL,
    scopes text[] DEFAULT ARRAY['wormholes'::text],
    system_labels text DEFAULT '[{"id":"a","name":"A","color":"#2d803b"},{"id":"b","name":"B","color":"#3d94af"},{"id":"c","name":"C","color":"#3d94af"},{"id":"1","name":"1","color":"#563daf"},{"id":"2","name":"2","color":"#8f3daf"},{"id":"3","name":"3","color":"#3d65af"}]'::text NOT NULL,
    discord_webhook_url text,
    home_solar_system_id bigint,
    discord_last_digest bigint,
    home_share_token text,
    home_share_full boolean DEFAULT false NOT NULL
);

