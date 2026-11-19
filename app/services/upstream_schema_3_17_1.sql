-- Schema of original Remote Terminal for MeshCore 3.17.1 (jkingsman), user_version 63.
-- Generated from a fresh database created by upstream's own code at tag 3.17.1.
-- Do not edit by hand. Used by app/services/upstream_export.py.

CREATE TABLE channels (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_hashtag INTEGER DEFAULT 0,
    on_radio INTEGER DEFAULT 0,
    flood_scope_override TEXT,
    path_hash_mode_override INTEGER,
    last_read_at INTEGER,
    favorite INTEGER DEFAULT 0,
    muted INTEGER DEFAULT 0
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    conversation_key TEXT NOT NULL,
    text TEXT NOT NULL,
    sender_timestamp INTEGER,
    received_at INTEGER NOT NULL,
    paths TEXT,
    txt_type INTEGER DEFAULT 0,
    signature TEXT,
    outgoing INTEGER DEFAULT 0,
    acked INTEGER DEFAULT 0,
    sender_name TEXT,
    sender_key TEXT
    -- Deduplication: channel echoes/repeats use a content/time unique index so
    -- duplicate observations reconcile onto a single stored row. Legacy
    -- databases may also gain an incoming-DM content index via migration 44.
    -- Enforced via idx_messages_dedup_null_safe (unique index) rather than a table constraint
    -- to avoid the storage overhead of SQLite's autoindex duplicating every message text.
, transport_code INTEGER, region TEXT);

CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_radio_contacts INTEGER DEFAULT 200,
    auto_decrypt_dm_on_advert INTEGER DEFAULT 1,
    last_message_times TEXT DEFAULT '{}',
    preferences_migrated INTEGER DEFAULT 0,
    advert_interval INTEGER DEFAULT 0,
    last_advert_time INTEGER DEFAULT 0,
    flood_scope TEXT DEFAULT '',
    blocked_keys TEXT DEFAULT '[]',
    blocked_names TEXT DEFAULT '[]',
    discovery_blocked_types TEXT DEFAULT '[]',
    tracked_telemetry_repeaters TEXT DEFAULT '[]',
    auto_resend_channel INTEGER DEFAULT 0,
    telemetry_interval_hours INTEGER DEFAULT 8,
    vapid_private_key TEXT DEFAULT '',
    vapid_public_key TEXT DEFAULT '',
    push_conversations TEXT DEFAULT '[]'
, telemetry_routed_hourly INTEGER DEFAULT 0, tracked_telemetry_contacts TEXT DEFAULT '[]', known_regions TEXT);

CREATE TABLE fanout_configs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    config TEXT NOT NULL DEFAULT '{}',
    scope TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE repeater_telemetry_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
);

CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_success_at INTEGER,
    failure_count INTEGER DEFAULT 0,
    UNIQUE(endpoint)
);

CREATE TABLE "contacts" (
            public_key TEXT PRIMARY KEY,
            name TEXT,
            type INTEGER DEFAULT 0,
            flags INTEGER DEFAULT 0,
            direct_path TEXT,
            direct_path_len INTEGER,
            direct_path_hash_mode INTEGER,
            direct_path_updated_at INTEGER,
            route_override_path TEXT,
            route_override_len INTEGER,
            route_override_hash_mode INTEGER,
            last_advert INTEGER,
            lat REAL,
            lon REAL,
            last_seen INTEGER,
            on_radio INTEGER DEFAULT 0,
            last_contacted INTEGER,
            first_seen INTEGER,
            last_read_at INTEGER
        , favorite INTEGER DEFAULT 0);

CREATE TABLE "raw_packets" (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER NOT NULL, data BLOB NOT NULL, message_id INTEGER, payload_hash BLOB, FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL);

CREATE TABLE "contact_advert_paths" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_key TEXT NOT NULL,
                path_hex TEXT NOT NULL,
                path_len INTEGER NOT NULL,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                heard_count INTEGER NOT NULL DEFAULT 1,
                UNIQUE(public_key, path_hex, path_len),
                FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
            );

CREATE TABLE "contact_name_history" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_key TEXT NOT NULL,
                name TEXT NOT NULL,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                UNIQUE(public_key, name),
                FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
            );

CREATE TABLE contact_telemetry_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_key TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                data TEXT NOT NULL,
                FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
            );

CREATE INDEX idx_messages_sender_key ON messages(sender_key);

CREATE INDEX idx_messages_unread_covering ON messages(type, conversation_key, outgoing, received_at);

CREATE INDEX idx_messages_pagination ON messages(type, conversation_key, received_at DESC, id DESC);

CREATE UNIQUE INDEX idx_messages_dedup_null_safe
           ON messages(type, conversation_key, text, COALESCE(sender_timestamp, 0))
           WHERE type = 'CHAN';

CREATE INDEX idx_contacts_type_last_seen ON contacts(type, last_seen);

CREATE INDEX idx_messages_type_received_conversation
                ON messages(type, received_at, conversation_key)
                ;

CREATE INDEX idx_raw_packets_message_id ON raw_packets(message_id);

CREATE INDEX idx_raw_packets_timestamp ON raw_packets(timestamp);

CREATE UNIQUE INDEX idx_raw_packets_payload_hash ON raw_packets(payload_hash);

CREATE INDEX idx_contact_advert_paths_recent ON contact_advert_paths(public_key, last_seen DESC);

CREATE INDEX idx_contact_name_history_key ON contact_name_history(public_key, last_seen DESC);

CREATE INDEX idx_repeater_telemetry_pk_ts
            ON repeater_telemetry_history (public_key, timestamp)
        ;

CREATE UNIQUE INDEX idx_messages_incoming_priv_dedup
           ON messages(type, conversation_key, text, COALESCE(sender_timestamp, 0),
                       COALESCE(sender_key, ''))
           WHERE type = 'PRIV' AND outgoing = 0;

CREATE INDEX idx_contact_telemetry_pk_ts
                ON contact_telemetry_history(public_key, timestamp)
            ;

CREATE INDEX idx_messages_received ON messages(received_at);
