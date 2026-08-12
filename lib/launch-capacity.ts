/** Locked launch capacity contract. Reserved beta testers are not sale inventory. */
export const LAUNCH_CAPACITY = Object.freeze({
  beta_reserved: 25,
  og_throne: 50,
  early_bird: 150,
} as const);
