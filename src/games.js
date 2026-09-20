export function parseWager(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value)
    .trim()
    .toLowerCase();

  // Examples:
  // 1m, 30m, 1h, 12h, 1d, 2d, 1w
  const match = raw.match(/^(\d+)\s*(m|h|d|w)$/);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }

  const units = {
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60
  };

  const seconds = amount * units[unit];

  // Minimum wager = 1 minute.
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 60
  ) {
    return null;
  }

  return seconds;
}
