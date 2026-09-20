// ============================================================
// Eternal TP - Gambling Games
// ============================================================

function secureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }

  const maxUint32 = 0x100000000;
  const limit = maxUint32 - (maxUint32 % maxExclusive);

  const values = new Uint32Array(1);

  while (true) {
    crypto.getRandomValues(values);

    const value = values[0];

    if (value < limit) {
      return value % maxExclusive;
    }
  }
}

// ============================================================
// COINFLIP
//
// 50 / 50.
//
// Win:
//   + wager
//
// Loss:
//   - wager
// ============================================================

export function playCoinflip(choice) {
  choice = String(choice || "")
    .trim()
    .toLowerCase();

  if (choice !== "heads" && choice !== "tails") {
    return {
      ok: false,
      error: "INVALID_CHOICE"
    };
  }

  const result =
    secureRandomInt(2) === 0
      ? "heads"
      : "tails";

  return {
    ok: true,
    choice,
    result,
    won: choice === result,
    multiplier: 1
  };
}

// ============================================================
// SPIN
//
// Weighted wheel.
//
// The multiplier represents PROFIT/LOSS relative to the wager.
//
// 0x:
//   lose wager
//
// 0.5x:
//   lose half wager
//
// 1x:
//   wager returned / no balance change
//
// 1.5x:
//   win half wager
//
// 2x:
//   win wager
//
// 3x:
//   win 2x wager
// ============================================================

const SPIN_TABLE = [
  {
    label: "0x",
    multiplier: 0,
    weight: 30
  },
  {
    label: "0.5x",
    multiplier: 0.5,
    weight: 20
  },
  {
    label: "1x",
    multiplier: 1,
    weight: 20
  },
  {
    label: "1.5x",
    multiplier: 1.5,
    weight: 15
  },
  {
    label: "2x",
    multiplier: 2,
    weight: 10
  },
  {
    label: "3x",
    multiplier: 3,
    weight: 5
  }
];

export function playSpin() {
  const totalWeight = SPIN_TABLE.reduce(
    (total, entry) => total + entry.weight,
    0
  );

  let roll = secureRandomInt(totalWeight);

  for (const entry of SPIN_TABLE) {
    if (roll < entry.weight) {
      return {
        ok: true,
        label: entry.label,
        multiplier: entry.multiplier
      };
    }

    roll -= entry.weight;
  }

  // Should never happen.
  const fallback = SPIN_TABLE[0];

  return {
    ok: true,
    label: fallback.label,
    multiplier: fallback.multiplier
  };
}

// ============================================================
// CALCULATE SPIN BALANCE CHANGE
// ============================================================

export function calculateSpinChange(wager, multiplier) {
  wager = Math.floor(Number(wager));
  multiplier = Number(multiplier);

  if (
    !Number.isFinite(wager) ||
    wager <= 0 ||
    !Number.isFinite(multiplier) ||
    multiplier < 0
  ) {
    throw new Error("Invalid spin calculation");
  }

  // Example:
  //
  // wager = 600 seconds
  //
  // 0x   -> -600
  // 0.5x -> -300
  // 1x   -> 0
  // 1.5x -> +300
  // 2x   -> +600
  // 3x   -> +1200

  return Math.floor(
    wager * (multiplier - 1)
  );
}

// ============================================================
// WAGER PARSER
//
// Discord command amounts will support:
//
// 30s
// 5m
// 2h
// 1d
//
// A plain number is interpreted as minutes:
//
// 10 -> 10 minutes
// ============================================================

export function parseWager(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value)
    .trim()
    .toLowerCase();

  if (!raw) {
    return null;
  }

  const match = raw.match(
    /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/
  );

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2] || "m";

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  let multiplier;

  switch (unit) {
    case "s":
      multiplier = 1;
      break;

    case "m":
      multiplier = 60;
      break;

    case "h":
      multiplier = 60 * 60;
      break;

    case "d":
      multiplier = 24 * 60 * 60;
      break;

    default:
      return null;
  }

  const seconds = Math.floor(
    amount * multiplier
  );

  if (seconds <= 0) {
    return null;
  }

  return seconds;
}

// ============================================================
// TIME FORMATTER
// ============================================================

export function formatTime(totalSeconds) {
  totalSeconds = Math.max(
    0,
    Math.floor(Number(totalSeconds) || 0)
  );

  const days = Math.floor(totalSeconds / 86400);

  totalSeconds %= 86400;

  const hours = Math.floor(totalSeconds / 3600);

  totalSeconds %= 3600;

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (
    seconds > 0 ||
    parts.length === 0
  ) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}

// ============================================================
// MAX WAGER
// ============================================================

export function validateWager(
  wager,
  balance,
  maxGambleSeconds
) {
  wager = Math.floor(Number(wager));
  balance = Math.floor(Number(balance));

  const max = Math.floor(
    Number(maxGambleSeconds) || 3600
  );

  if (!Number.isFinite(wager) || wager <= 0) {
    return {
      ok: false,
      error: "INVALID_WAGER"
    };
  }

  if (wager > balance) {
    return {
      ok: false,
      error: "INSUFFICIENT_TIME"
    };
  }

  if (wager > max) {
    return {
      ok: false,
      error: "WAGER_TOO_LARGE",
      max
    };
  }

  return {
    ok: true,
    wager
  };
}
