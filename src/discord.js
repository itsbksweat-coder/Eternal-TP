import {
  getUserByDiscordId,
  linkAccount,
  setPaused,
  redeemCode,
  addTime
} from "./database.js";

import {
  resolveRobloxUsername
} from "./roblox.js";

import {
  playCoinflip,
  playSpin,
  calculateSpinChange,
  parseWager,
  formatTime,
  validateWager
} from "./games.js";

// Discord interaction response types
const CHANNEL_MESSAGE = 4;

// Ephemeral: only command user sees response
const EPHEMERAL = 64;

function reply(content, ephemeral = true) {
  return {
    type: CHANNEL_MESSAGE,
    data: {
      content,
      flags: ephemeral ? EPHEMERAL : 0
    }
  };
}

function getDiscordUserId(interaction) {
  return (
    interaction?.member?.user?.id ||
    interaction?.user?.id ||
    null
  );
}

function getOption(interaction, name) {
  const options =
    interaction?.data?.options || [];

  return options.find(
    option => option.name === name
  )?.value;
}

// ============================================================
// /link
// ============================================================

async function commandLink(interaction, env) {
  const discordId =
    getDiscordUserId(interaction);

  const username =
    getOption(interaction, "username");

  if (!username) {
    return reply(
      "❌ You need to provide a Roblox username."
    );
  }

  const existing =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (existing) {
    return reply(
      `❌ Your Discord account is already linked to **${existing.roblox_username}** (${existing.roblox_user_id}).`
    );
  }

  const roblox =
    await resolveRobloxUsername(
      username
    );

  if (!roblox.ok) {
    if (roblox.error === "USER_NOT_FOUND") {
      return reply(
        "❌ I couldn't find that Roblox account."
      );
    }

    return reply(
      "❌ Roblox couldn't be reached right now. Try again shortly."
    );
  }

  const result =
    await linkAccount(
      env,
      discordId,
      roblox.id,
      roblox.username,
      roblox.displayName
    );

  if (!result.ok) {
    if (
      result.error ===
      "DISCORD_ALREADY_LINKED"
    ) {
      return reply(
        `❌ Your Discord account is already linked to **${result.user.roblox_username}**.`
      );
    }

    if (
      result.error ===
      "ROBLOX_ALREADY_LINKED"
    ) {
      return reply(
        "❌ That Roblox account is already attached to another Discord account."
      );
    }

    return reply(
      "❌ I couldn't link that account."
    );
  }

  return reply(
    `✅ Linked your Discord account to **${roblox.username}** (${roblox.id}).`
  );
}

// ============================================================
// /info
// ============================================================

async function commandInfo(interaction, env) {
  const discordId =
    getDiscordUserId(interaction);

  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return reply(
      "❌ You don't have a Roblox account linked yet. Use `/link` first."
    );
  }

  const status =
    Number(user.paused) === 1
      ? "Paused ⏸️"
      : "Active ▶️";

  return reply(
    [
      "### Eternal TP",
      "",
      `**Roblox:** ${user.roblox_username}`,
      `**Display Name:** ${user.roblox_display_name || user.roblox_username}`,
      `**User ID:** ${user.roblox_user_id}`,
      `**Time Remaining:** ${formatTime(user.time_remaining)}`,
      `**Status:** ${status}`
    ].join("\n")
  );
}

// ============================================================
// /pause
// ============================================================

async function commandPause(
  interaction,
  env
) {
  const discordId =
    getDiscordUserId(interaction);

  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return reply(
      "❌ Link your Roblox account first with `/link`."
    );
  }

  if (Number(user.paused) === 1) {
    return reply(
      `⏸️ Eternal TP is already paused. You have **${formatTime(user.time_remaining)}** remaining.`
    );
  }

  await setPaused(
    env,
    discordId,
    true
  );

  return reply(
    `⏸️ Eternal TP paused.\n\nRemaining time: **${formatTime(user.time_remaining)}**`
  );
}

// ============================================================
// /unpause
// ============================================================

async function commandUnpause(
  interaction,
  env
) {
  const discordId =
    getDiscordUserId(interaction);

  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return reply(
      "❌ Link your Roblox account first with `/link`."
    );
  }

  if (Number(user.paused) === 0) {
    return reply(
      `▶️ Eternal TP is already active. You have **${formatTime(user.time_remaining)}** remaining.`
    );
  }

  if (
    Number(user.time_remaining) <= 0
  ) {
    return reply(
      "❌ You have no time remaining. Redeem more time before unpausing."
    );
  }

  await setPaused(
    env,
    discordId,
    false
  );

  return reply(
    `▶️ Eternal TP unpaused.\n\nRemaining time: **${formatTime(user.time_remaining)}**`
  );
}

// ============================================================
// /redeem
// ============================================================

async function commandRedeem(
  interaction,
  env
) {
  const discordId =
    getDiscordUserId(interaction);

  const code =
    getOption(
      interaction,
      "code"
    );

  if (!code) {
    return reply(
      "❌ Enter a redeem code."
    );
  }

  const result =
    await redeemCode(
      env,
      discordId,
      code
    );

  if (!result.ok) {
    switch (result.error) {
      case "USER_NOT_FOUND":
        return reply(
          "❌ Link your Roblox account first with `/link`."
        );

      case "INVALID_CODE":
        return reply(
          "❌ That code doesn't exist."
        );

      case "ALREADY_REDEEMED":
        return reply(
          "❌ That code has already been redeemed."
        );

      case "CODE_NOT_FOR_USER":
        return reply(
          "❌ That code isn't assigned to your account."
        );

      default:
        return reply(
          "❌ The code couldn't be redeemed."
        );
    }
  }

  return reply(
    `✅ Redeemed **${result.code}** for **${formatTime(result.seconds)}**.\n\nNew balance: **${formatTime(result.balance)}**`
  );
}

// ============================================================
// /coinflip
// ============================================================

async function commandCoinflip(
  interaction,
  env
) {
  const discordId =
    getDiscordUserId(interaction);

  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return reply(
      "❌ Link your Roblox account first with `/link`."
    );
  }

  const wager =
    parseWager(
      getOption(
        interaction,
        "amount"
      )
    );

  const validation =
    validateWager(
      wager,
      Number(
        user.time_remaining
      ),
      env.MAX_GAMBLE_SECONDS
    );

  if (!validation.ok) {
    if (
      validation.error ===
      "INSUFFICIENT_TIME"
    ) {
      return reply(
        `❌ You only have **${formatTime(user.time_remaining)}** remaining.`
      );
    }

    if (
      validation.error ===
      "WAGER_TOO_LARGE"
    ) {
      return reply(
        `❌ Maximum wager is **${formatTime(validation.max)}**.`
      );
    }

    return reply(
      "❌ Invalid wager. Examples: `5m`, `30m`, `1h`."
    );
  }

  const choice =
    String(
      getOption(
        interaction,
        "choice"
      ) || ""
    ).toLowerCase();

  const game =
    playCoinflip(choice);

  if (!game.ok) {
    return reply(
      "❌ Choose either `heads` or `tails`."
    );
  }

  const change =
    game.won
      ? wager
      : -wager;

  const result =
    await addTime(
      env,
      discordId,
      change,
      "coinflip",
      JSON.stringify({
        choice: game.choice,
        result: game.result,
        wager
      })
    );

  if (!result.ok) {
    return reply(
      "❌ The coinflip couldn't be completed."
    );
  }

  if (game.won) {
    return reply(
      [
        `🪙 **${game.result.toUpperCase()}!**`,
        "",
        `You won **${formatTime(wager)}**.`,
        `Balance: **${formatTime(result.newBalance)}**`
      ].join("\n")
    );
  }

  return reply(
    [
      `🪙 **${game.result.toUpperCase()}!**`,
      "",
      `You lost **${formatTime(wager)}**.`,
      `Balance: **${formatTime(result.newBalance)}**`
    ].join("\n")
  );
}

// ============================================================
// /spin
// ============================================================

async function commandSpin(
  interaction,
  env
) {
  const discordId =
    getDiscordUserId(interaction);

  const user =
    await getUserByDiscordId(
      env,
      discordId
    );

  if (!user) {
    return reply(
      "❌ Link your Roblox account first with `/link`."
    );
  }

  const wager =
    parseWager(
      getOption(
        interaction,
        "amount"
      )
    );

  const validation =
    validateWager(
      wager,
      Number(
        user.time_remaining
      ),
      env.MAX_GAMBLE_SECONDS
    );

  if (!validation.ok) {
    if (
      validation.error ===
      "INSUFFICIENT_TIME"
    ) {
      return reply(
        `❌ You only have **${formatTime(user.time_remaining)}** remaining.`
      );
    }

    if (
      validation.error ===
      "WAGER_TOO_LARGE"
    ) {
      return reply(
        `❌ Maximum wager is **${formatTime(validation.max)}**.`
      );
    }

    return reply(
      "❌ Invalid wager. Examples: `5m`, `30m`, `1h`."
    );
  }

  const spin =
    playSpin();

  const change =
    calculateSpinChange(
      wager,
      spin.multiplier
    );

  // Safety check: never allow the wheel to
  // subtract more than the wager.
  const safeChange =
    Math.max(
      -wager,
      change
    );

  const result =
    await addTime(
      env,
      discordId,
      safeChange,
      "spin",
      JSON.stringify({
        result: spin.label,
        multiplier:
          spin.multiplier,
        wager
      })
    );

  if (!result.ok) {
    return reply(
      "❌ The spin couldn't be completed."
    );
  }

  let resultText;

  if (safeChange > 0) {
    resultText =
      `You won **${formatTime(safeChange)}**!`;
  } else if (safeChange < 0) {
    resultText =
      `You lost **${formatTime(Math.abs(safeChange))}**.`;
  } else {
    resultText =
      "Your wager was returned.";
  }

  return reply(
    [
      `🎰 **${spin.label}**`,
      "",
      resultText,
      `Balance: **${formatTime(result.newBalance)}**`
    ].join("\n")
  );
}

// ============================================================
// MAIN COMMAND ROUTER
// ============================================================

export async function handleDiscordCommand(
  interaction,
  env
) {
  const command =
    interaction?.data?.name;

  switch (command) {
    case "link":
      return commandLink(
        interaction,
        env
      );

    case "info":
      return commandInfo(
        interaction,
        env
      );

    case "pause":
      return commandPause(
        interaction,
        env
      );

    case "unpause":
      return commandUnpause(
        interaction,
        env
      );

    case "redeem":
      return commandRedeem(
        interaction,
        env
      );

    case "coinflip":
      return commandCoinflip(
        interaction,
        env
      );

    case "spin":
      return commandSpin(
        interaction,
        env
      );

    default:
      return reply(
        "❌ Unknown Eternal TP command."
      );
  }
}
