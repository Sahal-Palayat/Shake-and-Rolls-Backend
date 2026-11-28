/** A tracking link works for this long after it was generated. */
export const TRACKING_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** How long after delivery a customer may still leave a review (override with REVIEW_WINDOW_DAYS). */
export const DEFAULT_REVIEW_WINDOW_DAYS = 7;

/**
 * Expired / revoked token documents are kept this long past their expiry, so the customer sees
 * "this link expired" instead of "invalid link", then MongoDB's TTL index removes them.
 */
export const PURGE_AFTER_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_REVIEW_COMMENT_LENGTH = 500;

export enum AccessTokenKind {
  /** Customer-facing live tracking link. 24 h. */
  Tracking = 'tracking',
  /** Separate credential that only allows leaving the review. Outlives the tracking link. */
  Review = 'review',
}

export enum RevokeReason {
  Cancelled = 'cancelled',
  Rejected = 'rejected',
  /** A person invalidated the links (link leaked, wrong recipient, ...). Also blocks the review route. */
  Security = 'security',
  /** A newer review token replaced this one. */
  Superseded = 'superseded',
}
