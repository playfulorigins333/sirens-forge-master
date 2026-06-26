const DEFAULT_TIMEZONE = "America/New_York"

function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function normalizeDateOnly(value: unknown) {
  if (value == null || value === "") return { value: null }
  if (typeof value !== "string") return { error: "INVALID_DATE" as const }

  const date = value.trim()
  if (!isValidDateOnly(date)) return { error: "INVALID_DATE" as const }

  return { value: date }
}

function normalizeTimeSlot(value: unknown) {
  if (typeof value !== "string") return null

  const timeSlot = value.trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeSlot)) return null

  return timeSlot
}

export function validateXDraftSchedule(input: Record<string, unknown>) {
  const rawTimezone = typeof input.timezone === "string" && input.timezone.trim()
    ? input.timezone.trim()
    : DEFAULT_TIMEZONE

  if (!isValidTimezone(rawTimezone)) {
    return { error: "INVALID_TIMEZONE" as const }
  }

  const startDate = normalizeDateOnly(input.start_date)
  if (startDate.error) return { error: startDate.error }

  const endDate = normalizeDateOnly(input.end_date)
  if (endDate.error) return { error: endDate.error }

  if (startDate.value && endDate.value && endDate.value < startDate.value) {
    return { error: "INVALID_DATE_RANGE" as const }
  }

  const postsPerDay = input.posts_per_day == null ? 1 : Number(input.posts_per_day)
  if (!Number.isFinite(postsPerDay) || Math.floor(postsPerDay) !== 1) {
    return { error: "INVALID_POSTS_PER_DAY" as const }
  }

  const rawTimeSlots = Array.isArray(input.time_slots) ? input.time_slots : []
  if (rawTimeSlots.length !== 1) {
    return { error: "INVALID_TIME_SLOT" as const }
  }

  const timeSlot = normalizeTimeSlot(rawTimeSlots[0])
  if (!timeSlot) {
    return { error: "INVALID_TIME_SLOT" as const }
  }

  return {
    schedule: {
      timezone: rawTimezone,
      start_date: startDate.value,
      end_date: endDate.value,
      posts_per_day: 1,
      time_slots: [timeSlot],
    },
  }
}
