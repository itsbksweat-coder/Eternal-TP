function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function authorized(request, env) {
  if (!env.ADMIN_API_KEY) {
    console.error("ADMIN_API_KEY is not configured.");
    return false;
  }

  const auth = request.headers.get("authorization");

  if (!auth?.startsWith("Bearer ")) {
    return false;
  }

  return auth.slice(7).trim() === env.ADMIN_API_KEY;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function generateCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(16);

  crypto.getRandomValues(bytes);

  let output = "ET-";

  for (let i = 0; i < 12; i++) {
    output += alphabet[
      bytes[i] % alphabet.length
    ];

    if (i === 3 || i === 7) {
      output += "-";
    }
  }

  return output;
}

// ============================================================
// POST /api/admin/codes/create
//
// {
//   "seconds": 3600,
//   "code": "OPTIONAL-CUSTOM-CODE",
//   "discordId": "optional",
//   "robloxUserId": 123456
// }
// ============================================================

async function createCode(request, env) {
  const data = await body(request);

  if (!data) {
    return json({
      ok: false,
      error: "INVALID_JSON"
    }, 400);
  }

  const seconds = Math.floor(
    Number(data.seconds)
  );

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return json({
      ok: false,
      error: "INVALID_SECONDS"
    }, 400);
  }

  // Cap one code at one year.
  if (seconds > 31536000) {
    return json({
      ok: false,
      error: "TIME_TOO_LARGE"
    }, 400);
  }

  const code = data.code
    ? String(data.code)
        .trim()
        .toUpperCase()
    : generateCode();

  if (
    code.length < 4 ||
    code.length > 64
  ) {
    return json({
      ok: false,
      error: "INVALID_CODE"
    }, 400);
  }

  const discordId =
    data.discordId
      ? String(data.discordId)
      : null;

  const robloxUserId =
    data.robloxUserId !== undefined &&
    data.robloxUserId !== null
      ? Number(data.robloxUserId)
      : null;

  if (
    robloxUserId !== null &&
    (
      !Number.isInteger(robloxUserId) ||
      robloxUserId <= 0
    )
  ) {
    return json({
      ok: false,
      error: "INVALID_ROBLOX_USER_ID"
    }, 400);
  }

  try {
    await env.DB
      .prepare(`
        INSERT INTO redeem_codes (
          code,
          seconds,
          discord_id,
          roblox_user_id
        )
        VALUES (?, ?, ?, ?)
      `)
      .bind(
        code,
        seconds,
        discordId,
        robloxUserId
      )
      .run();
  } catch (error) {
    const message = String(
      error?.message || error
    );

    if (
      message.includes("UNIQUE") ||
      message.includes("unique")
    ) {
      return json({
        ok: false,
        error: "CODE_ALREADY_EXISTS"
      }, 409);
    }

    throw error;
  }

  return json({
    ok: true,
    code,
    seconds,
    discordId,
    robloxUserId
  });
}

// ============================================================
// GET /api/admin/codes
// ============================================================

async function listCodes(env) {
  const result = await env.DB
    .prepare(`
      SELECT
        id,
        code,
        seconds,
        discord_id,
        roblox_user_id,
        redeemed,
        redeemed_by_discord_id,
        redeemed_by_roblox_user_id,
        redeemed_at,
        created_at
      FROM redeem_codes
      ORDER BY id DESC
      LIMIT 100
    `)
    .all();

  return json({
    ok: true,
    codes: result.results || []
  });
}

// ============================================================
// ADMIN ROUTER
// ============================================================

export async function handleAdminRequest(
  request,
  env,
  pathname
) {
  if (!authorized(request, env)) {
    return json({
      ok: false,
      error: "UNAUTHORIZED"
    }, 401);
  }

  if (
    pathname === "/api/admin/codes/create" &&
    request.method === "POST"
  ) {
    return createCode(request, env);
  }

  if (
    pathname === "/api/admin/codes" &&
    request.method === "GET"
  ) {
    return listCodes(env);
  }

  return json({
    ok: false,
    error: "NOT_FOUND"
  }, 404);
}
