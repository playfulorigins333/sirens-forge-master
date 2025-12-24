export type PlatformId =
  | "fanvue"
  | "onlyfans"
  | "fansly"
  | "loyalfans"
  | "justforfans"
  | "x"
  | "reddit";

export type ApprovalState = "DRAFT" | "APPROVED" | "PAUSED" | "REVOKED";

export type AutopostRule = {
  id: string;
  user_id: string;

  enabled: boolean;
  selected_platforms: PlatformId[];
  explicitness: number;
  tones: string[];

  timezone: string;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null;   // YYYY-MM-DD
  posts_per_day: number;
  time_slots: string[];      // ["09:30", "13:00"]

  approval_state: ApprovalState;
  approved_at: string | null;
  paused_at: string | null;
  revoked_at: string | null;

  accept_split: boolean;
  accept_automation: boolean;
  accept_control: boolean;

  creator_pct: number;   // locked 80
  platform_pct: number;  // locked 20

  next_run_at: string | null;
  last_run_at: string | null;

  created_at: string;
  updated_at: string;
};

export function assertPlatformId(x: string): asserts x is PlatformId {
  const ok = ["fanvue","onlyfans","fansly","loyalfans","justforfans","x","reddit"].includes(x);
  if (!ok) throw new Error(`Invalid platform: ${x}`);
}

export function clampInt(n: number, min: number, max: number): number {
  const v = Math.floor(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, v));
}
