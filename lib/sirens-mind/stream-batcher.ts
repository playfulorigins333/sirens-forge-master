type Schedule = (callback: () => void) => unknown
type Cancel = (handle: unknown) => void

export function createTextBatcher(commit: (text: string) => void, schedule: Schedule, cancel: Cancel) {
  let pending = ""
  let scheduled: unknown = null
  let disposed = false

  const flush = () => {
    if (disposed) return
    if (scheduled !== null) { cancel(scheduled); scheduled = null }
    if (!pending) return
    const text = pending
    pending = ""
    commit(text)
  }

  return {
    append(text: string) {
      if (disposed || !text) return
      pending += text
      if (scheduled === null) scheduled = schedule(flush)
    },
    flush,
    dispose() {
      disposed = true
      if (scheduled !== null) cancel(scheduled)
      scheduled = null
      pending = ""
    },
  }
}
