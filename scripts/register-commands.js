// ============================================================
// Eternal TP - Discord Slash Command Registration
// ============================================================
//
// Run with:
//
//   DISCORD_TOKEN=... DISCORD_APPLICATION_ID=... npm run commands
//
// Windows PowerShell:
//
//   $env:DISCORD_TOKEN="YOUR_TOKEN"
//   $env:DISCORD_APPLICATION_ID="YOUR_APPLICATION_ID"
//   npm run commands
//
// ============================================================

const TOKEN =
  process.env.DISCORD_TOKEN;

const APPLICATION_ID =
  process.env.DISCORD_APPLICATION_ID;

const GUILD_ID =
  process.env.DISCORD_GUILD_ID || null;

if (!TOKEN) {
  console.error(
    "Missing DISCORD_TOKEN environment variable."
  );

  process.exit(1);
}

if (!APPLICATION_ID) {
  console.error(
    "Missing DISCORD_APPLICATION_ID environment variable."
  );

  process.exit(1);
}

// ============================================================
// DISCORD OPTION TYPES
// ============================================================

const STRING = 3;

// ============================================================
// COMMANDS
// ============================================================

const commands = [
  {
    name: "link",
    description:
      "Link your Roblox account to Eternal TP",

    options: [
      {
        name: "username",
        description:
          "Your Roblox username",
        type: STRING,
        required: true
      }
    ]
  },

  {
    name: "info",
    description:
      "View your Eternal TP account"
  },

  {
    name: "pause",
    description:
      "Pause your Eternal TP time"
  },

  {
    name: "unpause",
    description:
      "Resume your Eternal TP time"
  },

  {
    name: "redeem",
    description:
      "Redeem an Eternal TP time code",

    options: [
      {
        name: "code",
        description:
          "Your redeem code",
        type: STRING,
        required: true
      }
    ]
  },

  {
    name: "coinflip",
    description:
      "Gamble some of your Eternal TP time",

    options: [
      {
        name: "amount",
        description:
          "Amount to wager, for example 10m or 1h",
        type: STRING,
        required: true
      },

      {
        name: "choice",
        description:
          "Heads or tails",
        type: STRING,
        required: true,

        choices: [
          {
            name: "Heads",
            value: "heads"
          },
          {
            name: "Tails",
            value: "tails"
          }
        ]
      }
    ]
  },

  {
    name: "spin",
    description:
      "Spin the Eternal TP time wheel",

    options: [
      {
        name: "amount",
        description:
          "Amount to wager, for example 10m or 1h",
        type: STRING,
        required: true
      }
    ]
  }
];

// ============================================================
// API ENDPOINT
// ============================================================

const endpoint =
  GUILD_ID
    ? `https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`;

// ============================================================
// REGISTER
// ============================================================

console.log(
  GUILD_ID
    ? `Registering commands to guild ${GUILD_ID}...`
    : "Registering global commands..."
);

const response =
  await fetch(
    endpoint,
    {
      method: "PUT",

      headers: {
        Authorization:
          `Bot ${TOKEN}`,

        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(
          commands
        )
    }
  );

const responseText =
  await response.text();

if (!response.ok) {
  console.error(
    "Discord rejected the command registration."
  );

  console.error(
    `HTTP ${response.status}`
  );

  console.error(
    responseText
  );

  process.exit(1);
}

let result;

try {
  result =
    JSON.parse(
      responseText
    );
} catch {
  result = [];
}

console.log(
  `Successfully registered ${result.length || commands.length} Eternal TP commands.`
);

for (const command of result) {
  console.log(
    `/${command.name}`
  );
}
