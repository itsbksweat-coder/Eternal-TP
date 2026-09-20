// ============================================================
// Eternal TP - Roblox API
// ============================================================

import {
  getUserByRobloxId,
  startGameSession,
  heartbeatSession,
  endGameSession,
  updateRobloxProfile
} from "./database.js";

const ROBLOX_USERS_API =
  "https://users.roblox.com";

// ============================================================
// RESPONSE
// ============================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",

        "cache-control":
          "no-store"
      }
    }
  );
}

// ============================================================
// READ JSON
// ============================================================

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// ============================================================
// ROBLOX USERNAME -> USER
// ============================================================

export async function resolveRobloxUsername(
  username
) {
  username =
    String(username || "")
      .trim();

  if (!username) {
    return {
      ok: false,
      error: "INVALID_USERNAME"
    };
  }

  try {
    const response =
      await fetch(
        `${ROBLOX_USERS_API}/v1/usernames/users`,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json",

            accept:
              "application/json"
          },

          body:
            JSON.stringify({
              usernames: [
                username
              ],

              excludeBannedUsers:
                false
            })
        }
      );

    if (!response.ok) {
      return {
        ok: false,
        error:
          "ROBLOX_API_ERROR"
      };
    }

    const data =
      await response.json();

    const user =
      data?.data?.[0];

    if (!user) {
      return {
        ok: false,
        error:
          "USER_NOT_FOUND"
      };
    }

    return {
      ok: true,

      id:
        Number(user.id),

      username:
        user.name,

      displayName:
        user.displayName
    };
  } catch (error) {
    console.error(
      "Roblox username lookup error:",
      error
    );

    return {
      ok: false,
      error:
        "ROBLOX_API_ERROR"
    };
  }
}

// ============================================================
// ROBLOX USER ID -> USER
// ============================================================

export async function resolveRobloxUserId(
  userId
) {
  userId =
    Number(userId);

  if (
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    return {
      ok: false,
      error:
        "INVALID_USER_ID"
    };
  }

  try {
    const response =
      await fetch(
        `${ROBLOX_USERS_API}/v1/users/${userId}`,
        {
          headers: {
            accept:
              "application/json"
          }
        }
      );

    if (
      response.status === 404
    ) {
      return {
        ok: false,
        error:
          "USER_NOT_FOUND"
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error:
          "ROBLOX_API_ERROR"
      };
    }

    const user =
      await response.json();

    return {
      ok: true,

      id:
        Number(user.id),

      username:
        user.name,

      displayName:
        user.displayName
    };
  } catch (error) {
    console.error(
      "Roblox user lookup error:",
      error
    );

    return {
      ok: false,
      error:
        "ROBLOX_API_ERROR"
    };
  }
}

// ============================================================
// GAME API AUTH
//
// Header:
//
// Authorization: Bearer YOUR_GAME_API_SECRET
// ============================================================

function authorizedGameRequest(
  request,
  env
) {
  if (!env.GAME_API_SECRET) {
    console.error(
      "GAME_API_SECRET is not configured."
    );

    return false;
  }

  const authorization =
    request.headers.get(
      "authorization"
    );

  if (!authorization) {
    return false;
  }

  if (
    !authorization.startsWith(
      "Bearer "
    )
  ) {
    return false;
  }

  const supplied =
    authorization
      .slice(7)
      .trim();

  return (
    supplied ===
    env.GAME_API_SECRET
  );
}

// ============================================================
// STATUS
//
// POST /api/roblox/status
//
// {
//   "userId": 123456
// }
// ============================================================

async function statusRoute(
  request,
  env
) {
  const body =
    await readBody(request);

  if (!body) {
    return json(
      {
        ok: false,
        error: "INVALID_JSON"
      },
      400
    );
  }

  const userId =
    Number(body.userId);

  if (
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_USER_ID"
      },
      400
    );
  }

  const user =
    await getUserByRobloxId(
      env,
      userId
    );

  if (!user) {
    return json(
      {
        ok: false,
        linked: false,
        error:
          "USER_NOT_LINKED"
      },
      404
    );
  }

  return json({
    ok: true,
    linked: true,

    user: {
      robloxUserId:
        Number(
          user.roblox_user_id
        ),

      username:
        user.roblox_username,

      displayName:
        user.roblox_display_name ||
        user.roblox_username,

      timeRemaining:
        Math.max(
          0,
          Number(
            user.time_remaining
          ) || 0
        ),

      paused:
        Number(
          user.paused
        ) === 1
    }
  });
}

// ============================================================
// REFRESH PROFILE
//
// POST /api/roblox/profile/refresh
//
// {
//   "userId": 123456
// }
// ============================================================

async function refreshProfileRoute(
  request,
  env
) {
  const body =
    await readBody(request);

  if (!body) {
    return json(
      {
        ok: false,
        error: "INVALID_JSON"
      },
      400
    );
  }

  const userId =
    Number(body.userId);

  if (
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_USER_ID"
      },
      400
    );
  }

  const linked =
    await getUserByRobloxId(
      env,
      userId
    );

  if (!linked) {
    return json(
      {
        ok: false,
        error:
          "USER_NOT_LINKED"
      },
      404
    );
  }

  const profile =
    await resolveRobloxUserId(
      userId
    );

  if (!profile.ok) {
    return json(
      {
        ok: false,
        error:
          profile.error
      },
      502
    );
  }

  await updateRobloxProfile(
    env,
    userId,
    profile.username,
    profile.displayName
  );

  return json({
    ok: true,

    user: {
      robloxUserId:
        profile.id,

      username:
        profile.username,

      displayName:
        profile.displayName
    }
  });
}

// ============================================================
// START SESSION
//
// POST /api/roblox/session/start
//
// {
//   "userId": 123456,
//   "placeId": 123,
//   "jobId": "abc"
// }
// ============================================================

async function startSessionRoute(
  request,
  env
) {
  const body =
    await readBody(request);

  if (!body) {
    return json(
      {
        ok: false,
        error: "INVALID_JSON"
      },
      400
    );
  }

  const userId =
    Number(body.userId);

  if (
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_USER_ID"
      },
      400
    );
  }

  const user =
    await getUserByRobloxId(
      env,
      userId
    );

  if (!user) {
    return json(
      {
        ok: false,
        error:
          "USER_NOT_LINKED"
      },
      404
    );
  }

  const remaining =
    Math.max(
      0,
      Number(
        user.time_remaining
      ) || 0
    );

  if (remaining <= 0) {
    return json(
      {
        ok: false,
        error:
          "NO_TIME_REMAINING",

        timeRemaining: 0
      },
      403
    );
  }

  if (
    Number(user.paused) === 1
  ) {
    return json(
      {
        ok: false,
        error:
          "ACCOUNT_PAUSED",

        timeRemaining:
          remaining
      },
      403
    );
  }

  const result =
    await startGameSession(
      env,
      userId,
      body.placeId ?? null,
      body.jobId ?? null
    );

  if (!result.ok) {
    return json(
      result,
      400
    );
  }

  return json({
    ok: true,

    sessionId:
      result.sessionId,

    timeRemaining:
      remaining,

    paused:
      false
  });
}

// ============================================================
// HEARTBEAT
//
// POST /api/roblox/session/heartbeat
//
// {
//   "sessionId": 1,
//   "userId": 123456
// }
// ============================================================

async function heartbeatRoute(
  request,
  env
) {
  const body =
    await readBody(request);

  if (!body) {
    return json(
      {
        ok: false,
        error: "INVALID_JSON"
      },
      400
    );
  }

  const sessionId =
    Number(
      body.sessionId
    );

  const userId =
    Number(
      body.userId
    );

  if (
    !Number.isInteger(sessionId) ||
    sessionId <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_SESSION_ID"
      },
      400
    );
  }

  if (
    !Number.isInteger(userId) ||
    userId <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_USER_ID"
      },
      400
    );
  }

  // getUserByRobloxId settles the
  // authoritative timer before returning.
  const user =
    await getUserByRobloxId(
      env,
      userId
    );

  if (!user) {
    return json(
      {
        ok: false,
        error:
          "USER_NOT_LINKED"
      },
      404
    );
  }

  const remaining =
    Math.max(
      0,
      Number(
        user.time_remaining
      ) || 0
    );

  if (
    remaining <= 0
  ) {
    await endGameSession(
      env,
      sessionId
    );

    return json(
      {
        ok: false,
        error:
          "NO_TIME_REMAINING",

        timeRemaining: 0
      },
      403
    );
  }

  if (
    Number(user.paused) === 1
  ) {
    await endGameSession(
      env,
      sessionId
    );

    return json(
      {
        ok: false,
        error:
          "ACCOUNT_PAUSED",

        timeRemaining:
          remaining
      },
      403
    );
  }

  const updated =
    await heartbeatSession(
      env,
      sessionId
    );

  if (!updated) {
    return json(
      {
        ok: false,
        error:
          "SESSION_NOT_FOUND"
      },
      404
    );
  }

  return json({
    ok: true,

    sessionId,

    timeRemaining:
      remaining,

    paused:
      false
  });
}

// ============================================================
// END SESSION
//
// POST /api/roblox/session/end
//
// {
//   "sessionId": 1
// }
// ============================================================

async function endSessionRoute(
  request,
  env
) {
  const body =
    await readBody(request);

  if (!body) {
    return json(
      {
        ok: false,
        error: "INVALID_JSON"
      },
      400
    );
  }

  const sessionId =
    Number(
      body.sessionId
    );

  if (
    !Number.isInteger(sessionId) ||
    sessionId <= 0
  ) {
    return json(
      {
        ok: false,
        error:
          "INVALID_SESSION_ID"
      },
      400
    );
  }

  await endGameSession(
    env,
    sessionId
  );

  return json({
    ok: true
  });
}

// ============================================================
// ROBLOX ROUTER
// ============================================================

export async function handleRobloxRequest(
  request,
  env,
  pathname
) {
  // Every /api/roblox/* route requires
  // the server API secret.
  if (
    !authorizedGameRequest(
      request,
      env
    )
  ) {
    return json(
      {
        ok: false,
        error:
          "UNAUTHORIZED"
      },
      401
    );
  }

  if (
    request.method !== "POST"
  ) {
    return json(
      {
        ok: false,
        error:
          "METHOD_NOT_ALLOWED"
      },
      405
    );
  }

  switch (pathname) {
    case "/api/roblox/status":
      return statusRoute(
        request,
        env
      );

    case "/api/roblox/profile/refresh":
      return refreshProfileRoute(
        request,
        env
      );

    case "/api/roblox/session/start":
      return startSessionRoute(
        request,
        env
      );

    case "/api/roblox/session/heartbeat":
      return heartbeatRoute(
        request,
        env
      );

    case "/api/roblox/session/end":
      return endSessionRoute(
        request,
        env
      );

    default:
      return json(
        {
          ok: false,
          error:
            "NOT_FOUND"
        },
        404
      );
  }
}
