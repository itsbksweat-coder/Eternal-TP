// ============================================================
// Eternal TP - Gambling Games
// ============================================================

function secureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be positive");
  }

  const maxUint32 = 0x100000000;
  const limit =
    maxUint32 - (maxUint32 % maxExclusive);

  const values = new Uint32Array(1);

  while (true) {
    crypto.getRandomValues(values);

    if (values[0] < limit) {
      return values[0] % maxExclusive;
    }
  }
}

function rollPercent() {
  // 0-9999 gives us 0.01% precision.
  return secureRandomInt(10000) / 100;
}

// ============================================================
// COINFLIP
//
// WIN:  35%
// LOSS: 65%
//
// Winning gives +wager.
// Losing removes wager.
// ============================================================

export function playCoinflip(choice) {
  choice = String(choice || "")
    .trim()
    .toLowerCase();

  if (
    choice !== "heads" &&
    choice !== "tails"
  ) {
    return {
      ok: false,
      error: "INVALID_CHOICE"
    };
  }

  const won =
    rollPercent() < 35;

  let result;

  if (won) {
    result = choice;
  } else {
    result =
      choice === "heads"
        ? "tails"
        : "heads";
  }

  return {
    ok: true,
    choice,
    result,
    won,
    multiplier: won ? 2 : 0
  };
}

// ============================================================
// SPIN
//
// TOTAL PROFIT CHANCE = 30%
//
// 0x   = 30%
// 0.5x = 20%
// 1x   = 20%
// ----------------
// LOSS / EVEN = 70%
//
// 1.5x = 15%
// 2x   = 10%
// 3x   = 5%
// ----------------
// PROFIT = 30%
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
  const totalWeight =
    SPIN_TABLE.reduce(
      (total, entry) =>
        total + entry.weight,
      0
    );

  let roll =
    secureRandomInt(totalWeight);

  for (const entry of SPIN_TABLE) {
    if (roll < entry.weight) {
      return {
        ok: true,
        label: entry.label,
        multiplier:
          entry.multiplier
      };
    }

    roll -= entry.weight;
  }

  // Failsafe
  return {
    ok: true,
    label: "0x",
    multiplier: 0
  };
}

// ============================================================
// SPIN BALANCE CHANGE
// ============================================================

export function calculateSpinChange(
  wager,
  multiplier
) {
  wager =
    Math.floor(Number(wager));

  multiplier =
    Number(multiplier);

  if (
    !Number.isFinite(wager) ||
    wager <= 0 ||
    !Number.isFinite(multiplier) ||
    multiplier < 0
  ) {
    throw new Error(
      "Invalid spin calculation"
    );
  }

  // Example with 1 hour:
  //
  // 0x   -> -1h
  // 0.5x -> -30m
  // 1x   -> no change
  // 1.5x -> +30m
  // 2x   -> +1h
  // 3x   -> +2h

  return Math.floor(
    wager * (multiplier - 1)
  );
}

// ============================================================
// WAGER PARSER
//
// REQUIRED UNIT.
//
// 1m
// 30m
// 1h
// 12h
// 1d
// 2d
// 1w
// 4w
//
// Seconds are intentionally NOT supported.
// ============================================================

export function parseWager(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const raw =
    String(value)
      .trim()
      .toLowerCase();

  const match =
    raw.match(
      /^(\d+)\s*(m|h|d|w)$/
    );

  if (!match) {
    return null;
  }

  const amount =
    Number(match[1]);

  const unit =
    match[2];

  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return null;
  }

  const units = {
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60
  };

  const seconds =
    amount * units[unit];

  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 60
  ) {
    return null;
  }

  return seconds;
}

// ============================================================
// TIME FORMATTER
// ============================================================

export function formatTime(
  totalSeconds
) {
  totalSeconds =
    Math.max(
      0,
      Math.floor(
        Number(totalSeconds) || 0
      )
    );

  const weeks =
    Math.floor(
      totalSeconds / 604800
    );

  totalSeconds %= 604800;

  const days =
    Math.floor(
      totalSeconds / 86400
    );

  totalSeconds %= 86400;

  const hours =
    Math.floor(
      totalSeconds / 3600
    );

  totalSeconds %= 3600;

  const minutes =
    Math.floor(
      totalSeconds / 60
    );

  const seconds =
    totalSeconds % 60;

  const parts = [];

  if (weeks > 0) {
    parts.push(`${weeks}w`);
  }

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
// WAGER VALIDATION
//
// Minimum = 1 minute
// Maximum = user's available balance
// ============================================================

export function validateWager(
  wager,
  balance
) {
  wager =
    Math.floor(Number(wager));

  balance =
    Math.floor(Number(balance));

  if (
    !Number.isFinite(wager) ||
    wager < 60
  ) {
    return {
      ok: false,
      error: "INVALID_WAGER"
    };
  }

  if (
    !Number.isFinite(balance) ||
    wager > balance
  ) {
    return {
      ok: false,
      error:
        "INSUFFICIENT_TIME"
    };
  }

  return {
    ok: true,
    wager
  };
}
