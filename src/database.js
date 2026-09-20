// ============================================================
// Eternal TP - Database / Timer Layer
// ============================================================

function now() {
  return Math.floor(Date.now() / 1000);
}

function normalizeUser(user) {
  if (!user) return null;

  const stored = Math.max(
    0,
    Number(user.time_remaining) || 0
  );

  const paused =
    Number(user.paused) === 1;

  const started =
    Number(user.timer_started_at) || 0;

  let remaining = stored;

  if (
    !paused &&
    started > 0 &&
    stored > 0
  ) {
    remaining = Math.max(
      0,
      stored - Math.max(0, now() - started)
    );
  }

  return {
    ...user,
    time_remaining: remaining
  };
}

async function rawDiscord(env, discordId) {
  return env.DB
    .prepare(`
      SELECT *
      FROM users
      WHERE discord_id = ?
      LIMIT 1
    `)
    .bind(String(discordId))
    .first();
}

async function rawRoblox(env, robloxUserId) {
  return env.DB
    .prepare(`
      SELECT *
      FROM users
      WHERE roblox_user_id = ?
      LIMIT 1
    `)
    .bind(Number(robloxUserId))
    .first();
}

async function settle(env, raw) {
  if (!raw) return null;

  const user = normalizeUser(raw);

  if (
    Number(raw.paused) === 0 &&
    Number(raw.timer_started_at) > 0
  ) {
    const remaining =
      Number(user.time_remaining);

    await env.DB
      .prepare(`
        UPDATE users
        SET
          time_remaining = ?,
          timer_started_at = ?,
          paused = CASE
            WHEN ? <= 0 THEN 1
            ELSE paused
          END,
          updated_at = unixepoch()
        WHERE id = ?
      `)
      .bind(
        remaining,
        remaining > 0 ? now() : null,
        remaining,
        Number(raw.id)
      )
      .run();

    user.timer_started_at =
      remaining > 0 ? now() : null;

    if (remaining <= 0) {
      user.paused = 1;
    }
  }

  return user;
}

export async function getUserByDiscordId(
  env,
  discordId
) {
  return settle(
    env,
    await rawDiscord(env, discordId)
  );
}

export async function getUserByRobloxId(
  env,
  robloxUserId
) {
  return settle(
    env,
    await rawRoblox(env, robloxUserId)
  );
}

// ============================================================
// LINK
// ============================================================

export async function linkAccount(
  env,
  discordId,
  robloxUserId,
  robloxUsername,
  robloxDisplayName = null
) {
  discordId = String(discordId);
  robloxUserId = Number(robloxUserId);

  const discord =
    await rawDiscord(env, discordId);

  if (discord) {
    return {
      ok:
        Number(discord.roblox_user_id) ===
        robloxUserId,

      alreadyLinked: true,

      error:
        Number(discord.roblox_user_id) === robloxUserId
          ? null
          : "DISCORD_ALREADY_LINKED",

      user:
        await settle(env, discord)
    };
  }

  const roblox =
    await rawRoblox(env, robloxUserId);

  if (roblox) {
    return {
      ok: false,
      error: "ROBLOX_ALREADY_LINKED",
      user:
        await settle(env, roblox)
    };
  }

  try {
    await env.DB
      .prepare(`
        INSERT INTO users (
          discord_id,
          roblox_user_id,
          roblox_username,
          roblox_display_name,
          time_remaining,
          paused,
          timer_started_at
        )
        VALUES (?, ?, ?, ?, 0, 1, NULL)
      `)
      .bind(
        discordId,
        robloxUserId,
        String(robloxUsername),
        robloxDisplayName
          ? String(robloxDisplayName)
          : null
      )
      .run();
  } catch (error) {
    if (
      await rawDiscord(env, discordId)
    ) {
      return {
        ok: false,
        error: "DISCORD_ALREADY_LINKED"
      };
    }

    if (
      await rawRoblox(env, robloxUserId)
    ) {
      return {
        ok: false,
        error: "ROBLOX_ALREADY_LINKED"
      };
    }

    throw error;
  }

  return {
    ok: true,
    alreadyLinked: false,
    user:
      await getUserByDiscordId(
        env,
        discordId
      )
  };
}

// ============================================================
// PROFILE
// ============================================================

export async function updateRobloxProfile(
  env,
  robloxUserId,
  username,
  displayName
) {
  await env.DB
    .prepare(`
      UPDATE users
      SET
        roblox_username = ?,
        roblox_display_name = ?,
        updated_at = unixepoch()
      WHERE roblox_user_id = ?
    `)
    .bind(
      String(username),
      displayName
        ? String(displayName)
        : null,
      Number(robloxUserId)
    )
    .run();
}

// ============================================================
// PAUSE
// ============================================================

export async function setPaused(
  env,
  discordId,
  paused
) {
  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return false;
  }

  const remaining =
    Math.max(
      0,
      Number(user.time_remaining) || 0
    );

  if (paused) {
    await env.DB
      .prepare(`
        UPDATE users
        SET
          time_remaining = ?,
          paused = 1,
          timer_started_at = NULL,
          updated_at = unixepoch()
        WHERE discord_id = ?
      `)
      .bind(
        remaining,
        String(discordId)
      )
      .run();

    return true;
  }

  if (remaining <= 0) {
    return false;
  }

  await env.DB
    .prepare(`
      UPDATE users
      SET
        time_remaining = ?,
        paused = 0,
        timer_started_at = ?,
        updated_at = unixepoch()
      WHERE discord_id = ?
    `)
    .bind(
      remaining,
      now(),
      String(discordId)
    )
    .run();

  return true;
}

// ============================================================
// SET TIME
// ============================================================

export async function setTime(
  env,
  discordId,
  seconds
) {
  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) return null;

  seconds =
    Math.max(
      0,
      Math.floor(Number(seconds) || 0)
    );

  const active =
    Number(user.paused) === 0 &&
    seconds > 0;

  await env.DB
    .prepare(`
      UPDATE users
      SET
        time_remaining = ?,
        paused = ?,
        timer_started_at = ?,
        updated_at = unixepoch()
      WHERE discord_id = ?
    `)
    .bind(
      seconds,
      seconds <= 0
        ? 1
        : Number(user.paused),

      active ? now() : null,

      String(discordId)
    )
    .run();

  return getUserByDiscordId(
    env,
    discordId
  );
}

// ============================================================
// ADD / REMOVE TIME
// ============================================================

export async function addTime(
  env,
  discordId,
  amount,
  type = "adjustment",
  details = null
) {
  amount =
    Math.floor(Number(amount));

  if (!Number.isFinite(amount)) {
    return {
      ok: false,
      error: "INVALID_AMOUNT"
    };
  }

  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return {
      ok: false,
      error: "USER_NOT_FOUND"
    };
  }

  const oldBalance =
    Math.max(
      0,
      Number(user.time_remaining) || 0
    );

  const newBalance =
    Math.max(
      0,
      oldBalance + amount
    );

  const actualChange =
    newBalance - oldBalance;

  let paused =
    Number(user.paused);

  if (newBalance <= 0) {
    paused = 1;
  }

  const timerStarted =
    paused === 0 &&
    newBalance > 0
      ? now()
      : null;

  await env.DB.batch([
    env.DB
      .prepare(`
        UPDATE users
        SET
          time_remaining = ?,
          paused = ?,
          timer_started_at = ?,
          updated_at = unixepoch()
        WHERE discord_id = ?
      `)
      .bind(
        newBalance,
        paused,
        timerStarted,
        String(discordId)
      ),

    env.DB
      .prepare(`
        INSERT INTO transactions (
          discord_id,
          roblox_user_id,
          type,
          amount,
          balance_after,
          details
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        String(discordId),
        Number(user.roblox_user_id),
        String(type),
        actualChange,
        newBalance,
        details
          ? String(details)
          : null
      )
  ]);

  return {
    ok: true,
    oldBalance,
    newBalance,
    change: actualChange
  };
}

// ============================================================
// REDEEM
// ============================================================

export async function redeemCode(
  env,
  discordId,
  rawCode
) {
  const code =
    String(rawCode || "")
      .trim()
      .toUpperCase();

  if (!code) {
    return {
      ok: false,
      error: "INVALID_CODE"
    };
  }

  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return {
      ok: false,
      error: "USER_NOT_FOUND"
    };
  }

  const redeem =
    await env.DB
      .prepare(`
        SELECT *
        FROM redeem_codes
        WHERE UPPER(code) = ?
        LIMIT 1
      `)
      .bind(code)
      .first();

  if (!redeem) {
    return {
      ok: false,
      error: "INVALID_CODE"
    };
  }

  if (
    Number(redeem.redeemed) === 1
  ) {
    return {
      ok: false,
      error: "ALREADY_REDEEMED"
    };
  }

  if (
    redeem.discord_id &&
    String(redeem.discord_id) !==
      String(discordId)
  ) {
    return {
      ok: false,
      error: "CODE_NOT_FOR_USER"
    };
  }

  if (
    redeem.roblox_user_id &&
    Number(redeem.roblox_user_id) !==
      Number(user.roblox_user_id)
  ) {
    return {
      ok: false,
      error: "CODE_NOT_FOR_USER"
    };
  }

  const seconds =
    Math.max(
      0,
      Math.floor(
        Number(redeem.seconds) || 0
      )
    );

  if (seconds <= 0) {
    return {
      ok: false,
      error: "INVALID_CODE"
    };
  }

  const claim =
    await env.DB
      .prepare(`
        UPDATE redeem_codes
        SET
          redeemed = 1,
          redeemed_by_discord_id = ?,
          redeemed_by_roblox_user_id = ?,
          redeemed_at = unixepoch()
        WHERE id = ?
          AND redeemed = 0
      `)
      .bind(
        String(discordId),
        Number(user.roblox_user_id),
        Number(redeem.id)
      )
      .run();

  if (
    claim.meta.changes !== 1
  ) {
    return {
      ok: false,
      error: "ALREADY_REDEEMED"
    };
  }

  const result =
    await addTime(
      env,
      discordId,
      seconds,
      "redeem",
      `Redeemed ${code}`
    );

  return {
    ok: true,
    code,
    seconds,
    balance:
      result.newBalance
  };
}

// ============================================================
// SESSION TRACKING
// ============================================================

export async function startGameSession(
  env,
  robloxUserId,
  placeId = null,
  jobId = null
) {
  const user =
    await getUserByRobloxId(
      env,
      robloxUserId
    );

  if (!user) {
    return {
      ok: false,
      error: "USER_NOT_FOUND"
    };
  }

  await env.DB
    .prepare(`
      UPDATE game_sessions
      SET
        active = 0,
        ended_at = unixepoch()
      WHERE roblox_user_id = ?
        AND active = 1
    `)
    .bind(Number(robloxUserId))
    .run();

  const result =
    await env.DB
      .prepare(`
        INSERT INTO game_sessions (
          roblox_user_id,
          place_id,
          job_id,
          active
        )
        VALUES (?, ?, ?, 1)
      `)
      .bind(
        Number(robloxUserId),
        placeId
          ? String(placeId)
          : null,
        jobId
          ? String(jobId)
          : null
      )
      .run();

  return {
    ok: true,
    sessionId:
      result.meta.last_row_id
  };
}

export async function heartbeatSession(
  env,
  sessionId
) {
  const result =
    await env.DB
      .prepare(`
        UPDATE game_sessions
        SET last_seen_at = unixepoch()
        WHERE id = ?
          AND active = 1
      `)
      .bind(Number(sessionId))
      .run();

  return result.meta.changes > 0;
}

export async function endGameSession(
  env,
  sessionId
) {
  const result =
    await env.DB
      .prepare(`
        UPDATE game_sessions
        SET
          active = 0,
          ended_at = unixepoch(),
          last_seen_at = unixepoch()
        WHERE id = ?
          AND active = 1
      `)
      .bind(Number(sessionId))
      .run();

  return result.meta.changes > 0;
}

// ============================================================
// HISTORY
// ============================================================

export async function getRecentTransactions(
  env,
  discordId,
  limit = 10
) {
  limit =
    Math.max(
      1,
      Math.min(
        50,
        Math.floor(
          Number(limit) || 10
        )
      )
    );

  const result =
    await env.DB
      .prepare(`
        SELECT *
        FROM transactions
        WHERE discord_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .bind(
        String(discordId),
        limit
      )
      .all();

  return result.results || [];
}
