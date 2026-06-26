import "server-only";

export type ScheduleAdvanceRule = {
  timezone: string | null;
  start_date: string | null;
  end_date: string | null;
  posts_per_day: number | null;
  time_slots: unknown;
};

export type ScheduleAdvanceDecision =
  | {
      ok: true;
      next_run_at: string | null;
      reason: "NEXT_SLOT_FOUND" | "NO_FUTURE_SLOT";
    }
  | {
      ok: false;
      next_run_at: null;
      error_code: string;
      error_message: string;
    };

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_LOOKAHEAD_DAYS = 370;

function isDateString(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

function normalizeTimeSlots(value: unknown) {
  if (!Array.isArray(value)) return null;

  const slots = value.filter((slot): slot is string => typeof slot === "string" && TIME_RE.test(slot));
  return slots.length === value.length ? slots : null;
}

function validateTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function localDateString(date: Date, timezone: string) {
  const parts = getZonedParts(date, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function maxDateString(a: string, b: string) {
  return a > b ? a : b;
}

function zonedDateTimeToUtc(dateString: string, timeString: string, timezone: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  const desiredUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  let guessMs = desiredUtcMs;

  // Convert a wall-clock date/time in an IANA timezone to UTC by comparing the
  // desired wall-clock parts with the wall-clock parts produced by the current
  // UTC guess. Two passes handles normal DST offset differences for MVP slots.
  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(guessMs), timezone);
    const actualUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guessMs += desiredUtcMs - actualUtcMs;
  }

  return new Date(guessMs);
}

export function calculateNextRunAtAfterPostedProof(args: {
  rule: ScheduleAdvanceRule;
  scheduled_for: string;
  now?: Date;
}): ScheduleAdvanceDecision {
  const timezone = args.rule.timezone || "UTC";
  if (!validateTimeZone(timezone)) {
    return {
      ok: false,
      next_run_at: null,
      error_code: "SCHEDULE_TIMEZONE_INVALID",
      error_message: "Rule timezone is invalid.",
    };
  }

  if (!args.scheduled_for || Number.isNaN(new Date(args.scheduled_for).getTime())) {
    return {
      ok: false,
      next_run_at: null,
      error_code: "SCHEDULED_FOR_INVALID",
      error_message: "Posted job scheduled_for is invalid.",
    };
  }

  const postsPerDay = args.rule.posts_per_day ?? 1;
  const timeSlots = normalizeTimeSlots(args.rule.time_slots);

  // X MVP schedule advancement is intentionally narrow: one configured HH:mm
  // slot per day. This prevents inventing an unsafe cadence while X remains
  // non-selectable/non-schedulable in public status APIs.
  if (postsPerDay !== 1 || !timeSlots || timeSlots.length !== 1) {
    return {
      ok: false,
      next_run_at: null,
      error_code: "SCHEDULE_MVP_UNSUPPORTED",
      error_message: "X MVP schedule advancement requires one daily time slot.",
    };
  }

  if (args.rule.start_date !== null && !isDateString(args.rule.start_date)) {
    return {
      ok: false,
      next_run_at: null,
      error_code: "SCHEDULE_START_DATE_INVALID",
      error_message: "Rule start_date is invalid.",
    };
  }

  if (args.rule.end_date !== null && !isDateString(args.rule.end_date)) {
    return {
      ok: false,
      next_run_at: null,
      error_code: "SCHEDULE_END_DATE_INVALID",
      error_message: "Rule end_date is invalid.",
    };
  }

  const postedDate = new Date(args.scheduled_for);
  const postedLocalDate = localDateString(postedDate, timezone);
  const todayLocalDate = localDateString(args.now ?? new Date(), timezone);
  let cursorDate = maxDateString(addDays(postedLocalDate, 1), todayLocalDate);

  if (args.rule.start_date) {
    cursorDate = maxDateString(cursorDate, args.rule.start_date);
  }

  const endDate = args.rule.end_date;
  const postedMs = postedDate.getTime();
  const slot = timeSlots[0];

  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    if (endDate && cursorDate > endDate) {
      return { ok: true, next_run_at: null, reason: "NO_FUTURE_SLOT" };
    }

    const candidate = zonedDateTimeToUtc(cursorDate, slot, timezone);
    if (candidate.getTime() > postedMs) {
      return { ok: true, next_run_at: candidate.toISOString(), reason: "NEXT_SLOT_FOUND" };
    }

    cursorDate = addDays(cursorDate, 1);
  }

  return {
    ok: false,
    next_run_at: null,
    error_code: "SCHEDULE_NEXT_SLOT_NOT_FOUND",
    error_message: "No safe next schedule slot was found within the MVP lookahead window.",
  };
}
