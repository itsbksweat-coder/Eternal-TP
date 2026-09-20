-- ============================================================
-- Eternal TP
-- Initial D1 database schema
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- LINKED ACCOUNTS
--
-- One Discord account <-> one Roblox account.
--
-- UNIQUE(discord_id) prevents one Discord account from
-- attaching multiple Roblox accounts.
--
-- UNIQUE(roblox_user_id) prevents one Roblox account from
-- being attached to multiple Discord accounts.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    discord_id TEXT NOT NULL UNIQUE,

    roblox_user_id INTEGER NOT NULL UNIQUE,
    roblox_username TEXT NOT NULL,
    roblox_display_name TEXT,

    -- Remaining access time in seconds.
    time_remaining INTEGER NOT NULL DEFAULT 0,

    -- 0 = running
    -- 1 = paused
    paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),

    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_discord
ON users(discord_id);

CREATE INDEX IF NOT EXISTS idx_users_roblox
ON users(roblox_user_id);


-- ============================================================
-- REDEEM CODES
-- ============================================================

CREATE TABLE IF NOT EXISTS redeem_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    code TEXT NOT NULL UNIQUE,

    -- Number of seconds granted by the code.
    seconds INTEGER NOT NULL CHECK (seconds > 0),

    -- Optional Discord account restriction.
    discord_id TEXT,

    -- Optional Roblox account restriction.
    roblox_user_id INTEGER,

    redeemed INTEGER NOT NULL DEFAULT 0
        CHECK (redeemed IN (0, 1)),

    redeemed_by_discord_id TEXT,
    redeemed_by_roblox_user_id INTEGER,
    redeemed_at INTEGER,

    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_redeem_codes_code
ON redeem_codes(code);


-- ============================================================
-- TRANSACTION / AUDIT HISTORY
--
-- Records changes caused by redeeming or gambling.
-- ============================================================

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    discord_id TEXT NOT NULL,
    roblox_user_id INTEGER,

    type TEXT NOT NULL,

    -- Positive = time added
    -- Negative = time removed
    amount INTEGER NOT NULL,

    balance_after INTEGER NOT NULL,

    details TEXT,

    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_transactions_discord
ON transactions(discord_id);

CREATE INDEX IF NOT EXISTS idx_transactions_roblox
ON transactions(roblox_user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_created
ON transactions(created_at);


-- ============================================================
-- GAME SESSIONS
--
-- Used by the Roblox side to track an active Eternal TP
-- session.
-- ============================================================

CREATE TABLE IF NOT EXISTS game_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    roblox_user_id INTEGER NOT NULL,

    place_id TEXT,
    job_id TEXT,

    active INTEGER NOT NULL DEFAULT 1
        CHECK (active IN (0, 1)),

    started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
    ended_at INTEGER,

    FOREIGN KEY (roblox_user_id)
        REFERENCES users(roblox_user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_roblox
ON game_sessions(roblox_user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_active
ON game_sessions(active);
