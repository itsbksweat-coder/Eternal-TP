import {
  InteractionType,
  InteractionResponseType,
  verifyKey
} from "discord-interactions";

import {
  handleDiscordCommand
} from "./discord.js";

import {
  handleRobloxRequest
} from "./roblox.js";

// ============================================================
// HELPERS
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

function text(
  content,
  status = 200
) {
  return new Response(
    content,
    {
      status,
      headers: {
        "content-type":
          "text/plain; charset=UTF-8"
      }
    }
  );
}

// ============================================================
// DISCORD SIGNATURE VERIFICATION
// ============================================================

async function verifyDiscordRequest(
  request,
  env
) {
  const signature =
    request.headers.get(
      "x-signature-ed25519"
    );

  const timestamp =
    request.headers.get(
      "x-signature-timestamp"
    );

  if (
    !signature ||
    !timestamp ||
    !env.DISCORD_PUBLIC_KEY
  ) {
    return {
      valid: false
    };
  }

  const body =
    await request.text();

  let valid = false;

  try {
    valid = await verifyKey(
      body,
      signature,
      timestamp,
      env.DISCORD_PUBLIC_KEY
    );
  } catch (error) {
    console.error(
      "Discord verification error:",
      error
    );

    return {
      valid: false
    };
  }

  if (!valid) {
    return {
      valid: false
    };
  }

  try {
    return {
      valid: true,
      interaction:
        JSON.parse(body)
    };
  } catch {
    return {
      valid: false
    };
  }
}

// ============================================================
// DISCORD INTERACTIONS
// ============================================================

async function handleDiscord(
  request,
  env
) {
  if (request.method !== "POST") {
    return text(
      "Method Not Allowed",
      405
    );
  }

  const verified =
    await verifyDiscordRequest(
      request,
      env
    );

  if (!verified.valid) {
    return text(
      "Bad request signature",
      401
    );
  }

  const interaction =
    verified.interaction;

  // Discord validates the endpoint
  // using a PING interaction.
  if (
    interaction.type ===
    InteractionType.PING
  ) {
    return json({
      type:
        InteractionResponseType.PONG
    });
  }

  if (
    interaction.type ===
    InteractionType.APPLICATION_COMMAND
  ) {
    try {
      const response =
        await handleDiscordCommand(
          interaction,
          env
        );

      return json(response);
    } catch (error) {
      console.error(
        "Discord command error:",
        error
      );

      return json({
        type:
          InteractionResponseType
            .CHANNEL_MESSAGE_WITH_SOURCE,

        data: {
          content:
            "❌ Eternal TP encountered an internal error.",

          flags: 64
        }
      });
    }
  }

  return json({
    type:
      InteractionResponseType
        .CHANNEL_MESSAGE_WITH_SOURCE,

    data: {
      content:
        "Unsupported interaction.",

      flags: 64
    }
  });
}

// ============================================================
// HEALTH CHECK
// ============================================================

function health() {
  return json({
    ok: true,
    service: "Eternal TP",
    version: "2.0.0"
  });
}

// ============================================================
// MAIN WORKER
// ============================================================

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    try {
      const url =
        new URL(request.url);

      const pathname =
        url.pathname;

      // ----------------------------------------
      // Homepage
      // ----------------------------------------

      if (
        pathname === "/" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          service:
            "Eternal TP",

          version:
            "2.0.0",

          status:
            "online"
        });
      }

      // ----------------------------------------
      // Health
      // ----------------------------------------

      if (
        pathname ===
        "/health"
      ) {
        return health();
      }

      // ----------------------------------------
      // Discord
      // ----------------------------------------

      if (
        pathname ===
        "/discord/interactions"
      ) {
        return handleDiscord(
          request,
          env
        );
      }

      // ----------------------------------------
      // Roblox API
      // ----------------------------------------

      if (
        pathname.startsWith(
          "/api/roblox/"
        )
      ) {
        return handleRobloxRequest(
          request,
          env,
          pathname
        );
      }

      // ----------------------------------------
      // 404
      // ----------------------------------------

      return json(
        {
          ok: false,
          error:
            "NOT_FOUND"
        },
        404
      );
    } catch (error) {
      console.error(
        "Worker error:",
        error
      );

      return json(
        {
          ok: false,
          error:
            "INTERNAL_SERVER_ERROR"
        },
        500
      );
    }
  }
};
