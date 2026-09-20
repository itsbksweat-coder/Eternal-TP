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

import {
  handleAdminRequest
} from "./admin.js";

// ============================================================
// RESPONSE HELPERS
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

function text(content, status = 200) {
  return new Response(
    content,
    {
      status,
      headers: {
        "content-type":
          "text/plain; charset=UTF-8",

        "cache-control":
          "no-store"
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

  try {
    const valid =
      await verifyKey(
        body,
        signature,
        timestamp,
        env.DISCORD_PUBLIC_KEY
      );

    if (!valid) {
      return {
        valid: false
      };
    }

    return {
      valid: true,
      interaction:
        JSON.parse(body)
    };
  } catch (error) {
    console.error(
      "Discord verification error:",
      error
    );

    return {
      valid: false
    };
  }
}

// ============================================================
// DISCORD INTERACTION ENDPOINT
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

  // Discord uses PING to verify the endpoint.
  if (
    interaction.type ===
    InteractionType.PING
  ) {
    return json({
      type:
        InteractionResponseType.PONG
    });
  }

  // Slash command
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
// HEALTH
// ============================================================

function health() {
  return json({
    ok: true,
    service: "Eternal TP",
    version: "2.0.0",
    status: "online"
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

      // ======================================================
      // HOME
      // ======================================================

      if (
        pathname === "/" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          service: "Eternal TP",
          version: "2.0.0",
          status: "online"
        });
      }

      // ======================================================
      // HEALTH CHECK
      // ======================================================

      if (
        pathname === "/health" &&
        request.method === "GET"
      ) {
        return health();
      }

      // ======================================================
      // DISCORD
      // ======================================================

      if (
        pathname ===
        "/discord/interactions"
      ) {
        return handleDiscord(
          request,
          env
        );
      }

      // ======================================================
      // ROBLOX API
      // ======================================================

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

      // ======================================================
      // ADMIN API
      // ======================================================

      if (
        pathname.startsWith(
          "/api/admin/"
        )
      ) {
        return handleAdminRequest(
          request,
          env,
          pathname
        );
      }

      // ======================================================
      // NOT FOUND
      // ======================================================

      return json(
        {
          ok: false,
          error: "NOT_FOUND"
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
