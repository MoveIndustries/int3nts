/** Actual on-chain intent expiry (seconds). */
export const INTENT_EXPIRY_SECS = 180;

/** Interval between signature poll requests (ms). */
export const POLL_SIGNATURE_INTERVAL_MS = 2000;

/** Interval between fulfillment poll requests (ms). */
export const POLL_FULFILLMENT_INTERVAL_MS = 5000;

/** Delay before first fulfillment poll to let solver pick up intent (ms). */
export const POLL_FULFILLMENT_INITIAL_DELAY_MS = 3000;

/** Max signature poll attempts (attempts × POLL_SIGNATURE_INTERVAL_MS = total timeout). */
export const MAX_SIGNATURE_POLL_ATTEMPTS = 120;

/** Max fulfillment poll attempts (attempts × POLL_FULFILLMENT_INTERVAL_MS = total timeout). */
export const MAX_FULFILLMENT_POLL_ATTEMPTS = 240;

/** Basis points denominator (10000 bps = 100%). */
export const BPS_DENOMINATOR = BigInt(10000);

/** Rounding offset for ceiling division in bps fee calculation. */
export const BPS_ROUNDING_OFFSET = BigInt(9999);
