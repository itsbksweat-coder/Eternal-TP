// ============================================================
// Eternal TP - Database Helpers
// Cloudflare D1
// ============================================================

export async function getUserByDiscordId(env, discordId) {
  return await env.DB
    .prepare(`
      SELECT *
      FROM users
      WHERE discord_id = ?
      LIMIT 1
    `)
    .bind(String(discordId))
    .first();
}

export async function getUserByRobloxId(env, robloxUserId) {
  return await env.DB
    .prepare(`
      SELECT *
      FROM users
      WHERE roblox_user_id = ?
      LIMIT 1
    `)
    .bind(Number(robloxUserId))
    .first();
}

// ============================================================
// ACCOUNT LINKING
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

  const discordUser = await getUserByDiscordId(env, discordId);

  if (discordUser) {
    if (Number(discordUser.roblox_user_id) === robloxUserId) {
      return {
        ok: true,
        alreadyLinked: true,
        user: discordUser
      };
    }

    return {
      ok: false,
      error: "DISCORD_ALREADY_LINKED",
      user: discordUser
    };
  }

  const robloxUser = await getUserByRobloxId(env, robloxUserId);

  if (robloxUser) {
    return {
      ok: false,
      error: "ROBLOX_ALREADY_LINKED",
      user: robloxUser
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
          paused
        )
        VALUES (?, ?, ?, ?, 0, 0)
      `)
      .bind(
        discordId,
        robloxUserId,
        String(robloxUsername),
        robloxDisplayName ? String(robloxDisplayName) : null
      )
      .run();
  } catch (error) {
    // UNIQUE constraints are still the final protection against
    // two simultaneous link requests.
    const existingDiscord = await getUserByDiscordId(env, discordId);
    const existingRoblox = await getUserByRobloxId(env, robloxUserId);

    if (existingDiscord) {
      return {
        ok: false,
        error: "DISCORD_ALREADY_LINKED",
        user: existingDiscord
      };
    }

    if (existingRoblox) {
      return {
        ok: false,
        error: "ROBLOX_ALREADY_LINKED",
        user: existingRoblox
      };
    }

    throw error;
  }

  const user = await getUserByDiscordId(env, discordId);

  return {
    ok: true,
    alreadyLinked: false,
    user
  };
}

// ============================================================
// USER PROFILE UPDATE
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
      displayName ? String(displayName) : null,
      Number(robloxUserId)
    )
    .run();
}

// ============================================================
// PAUSE / UNPAUSE
// ============================================================

export async function setPaused(env, discordId, paused) {
  const result = await env.DB
    .prepare(`
      UPDATE users
      SET
        paused = ?,
        updated_at = unixepoch()
      WHERE discord_id = ?
    `)
    .bind(paused ? 1 : 0, String(discordId))
    .run();

  return result.meta.changes > 0;
}

// ============================================================
// TIME
// ============================================================

export async function setTime(env, discordId, seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds)));

  await env.DB
    .prepare(`
      UPDATE users
      SET
        time_remaining = ?,
        updated_at = unixepoch()
      WHERE discord_id = ?
    `)
    .bind(seconds, String(discordId))
    .run();

  return await getUserByDiscordId(env, discordId);
}

export async function addTime(
  env,
  discordId,
  amount,
  type = "adjustment",
  details = null
) {
  amount = Math.floor(Number(amount));

  const user = await getUserByDiscordId(env, discordId);

  if (!user) {
    return {
      ok: false,
      error: "USER_NOT_FOUND"
    };
  }

  const oldBalance = Number(user.time_remaining) || 0;
  const newBalance = Math.max(0, oldBalance + amount);

  const actualChange = newBalance - oldBalance;

  await env.DB.batch([
    env.DB
      .prepare(`
        UPDATE users
        SET
          time_remaining = ?,
          updated_at = unixepoch()
        WHERE discord_id = ?
      `)
      .bind(newBalance, String(discordId)),

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
        details ? String(details) : null
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

export async function redeemCode(env, discordId, rawCode) {
  const code = String(rawCode || "")
    .trim()
    .toUpperCase();

  if (!code) {
    return {
      ok: false,
      error: "INVALID_CODE"
    };
  }

  const user = await getUserByDiscordId(env, discordId);

  if (!user) {
    return {
      ok: false,
      error: "USER_NOT_FOUND"
    };
  }

  const redeem = await env.DB
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

  if (Number(redeem.redeemed) === 1) {
    return {
      ok: false,
      error: "ALREADY_REDEEMED"
    };
  }

  if (
    redeem.discord_id &&
    String(redeem.discord_id) !== String(discordId)
  ) {
    return {
      ok: false,
      error: "CODE_NOT_FOR_USER"
    };
  }

  if (
    redeem.roblox_user_id &&
    Number(redeem.roblox_user_id) !== Number(user.roblox_user_id)
  ) {
    return {
      ok: false,
      error: "CODE_NOT_FOR_USER"
    };
  }

  const seconds = Math.max(
    0,
    Math.floor(Number(redeem.seconds) || 0)
  );

  if (seconds <= 0) {
    return {
      ok: false,
      error: "INVALID_CODE"
    };
  }

  // Claim first. The WHERE redeemed = 0 condition makes sure
  // two requests cannot successfully redeem the same code.
  const claim = await env.DB
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

  if (claim.meta.changes !== 1) {
    return {
      ok: false,
      error: "ALREADY_REDEEMED"
    };
  }

  const timeResult = await addTime(
    env,
    discordId,
    seconds,
    "redeem",
    `Redeemed ${code}`
  );

  if (!timeResult.ok) {
    return timeResult;
  }

  return {
    ok: true,
    code,
    seconds,
    balance: timeResult.newBalance
  };
}

// ============================================================
// GAMBLING
// ============================================================

export async function gambleTime(
  env,
  discordId,
  wager,
  game,
  won,
  details = null
) {
  const user = await getUserByDiscordId(env, discordId);

  if (!user) {
    return {
      ok: false,
      error: "USER_NOT_FOUND"
    };
  }

  wager = Math.floor(Number(wager));

  if (!Number.isFinite(wager) || wager <= 0) {
    return {
      ok: false,
      error: "INVALID_WAGER"
    };
  }

  const balance = Number(user.time_remaining) || 0;

  if (wager > balance) {
    return {
      ok: false,
      error: "INSUFFICIENT_TIME",
      balance
    };
  }

  const change = won ? wager : -wager;

  const result = await addTime(
    env,
    discordId,
    change,
    game,
    details
  );

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    won: Boolean(won),
    wager,
    change: result.change,
    balance: result.newBalance
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
  const user = await getUserByRobloxId(env, robloxUserId);

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

  const result = await env.DB
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
      placeId ? String(placeId) : null,
      jobId ? String(jobId) : null
    )
    .run();

  return {
    ok: true,
    sessionId: result.meta.last_row_id
  };
}

export async function heartbeatSession(env, sessionId) {
  const result = await env.DB
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

export async function endGameSession(env, sessionId) {
  const result = await env.DB
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
// TRANSACTION HISTORY
// ============================================================

export async function getRecentTransactions(
  env,
  discordId,
  limit = 10
) {
  limit = Math.max(
    1,
    Math.min(50, Math.floor(Number(limit) || 10))
  );

  const result = await env.DB
    .prepare(`
      SELECT *
      FROM transactions
      WHERE discord_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)
    .bind(String(discordId), limit)
    .all();

  return result.results || [];
}
