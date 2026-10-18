// Program rules live here so they can be tuned in one place.
export const POINTS_PER_REAL = 1
export const CENTS_PER_POINT = 1
// A checkout that is not paid within this window gives its points back.
export const RESERVATION_TTL_MINUTES = 120
export const CODE_TTL_MINUTES = 10
export const CODE_MAX_ATTEMPTS = 5
export const LOYALTY_TOKEN_TTL_SECONDS = 30 * 60
