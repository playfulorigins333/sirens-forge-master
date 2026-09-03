"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import ChatUI from "./ChatUI"

type Subscriber = {
  id: string
  display_name: string
  platform: string
  platform_handle: string | null
  last_used_at?: string | null
  archived_at?: string | null
  updated_at?: string | null
}

type SubscriberDetails = Subscriber & { notes?: string }

type Conversation = {
  id: string
  status: string
  label: string
  last_used_at?: string | null
  updated_at?: string | null
}

type SubscriberFormMode = "new" | "edit" | null
type ConfirmKind = "discard-form" | "reset-context" | "delete-subscriber" | null

type SubscriberFormState = {
  displayName: string
  platform: string
  customPlatform: string
  handle: string
  notes: string
}

const PLATFORMS = [
  "OnlyFans",
  "Fanvue",
  "Fansly",
  "LoyalFans",
  "JustForFans",
  "Reddit",
  "X / Twitter",
  "Telegram",
  "Instagram",
  "Other",
]

const emptyForm = (): SubscriberFormState => ({
  displayName: "",
  platform: PLATFORMS[0],
  customPlatform: "",
  handle: "",
  notes: "",
})

const primaryPill =
  "rounded-full border border-transparent bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_0_22px_rgba(168,85,247,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
const secondaryPill =
  "rounded-full border border-white/10 bg-white/[0.035] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition hover:border-fuchsia-300/30 hover:bg-fuchsia-500/10 hover:text-white"
const fieldClass =
  "mt-2 w-full rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-[14px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-fuchsia-400/35 focus:bg-black/50 focus:ring-2 focus:ring-fuchsia-500/10"

function formatLastUsed(value?: string | null) {
  if (!value) return "No recent activity"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "No recent activity"
  return `Last used ${date.toLocaleDateString()}`
}

export default function CreatorReplyWorkspace() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [active, setActive] = useState<Subscriber | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [conversationList, setConversationList] = useState<Conversation[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [archivedView, setArchivedView] = useState(false)
  const [search, setSearch] = useState("")
  const [platformFilter, setPlatformFilter] = useState("")
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [chatEpoch, setChatEpoch] = useState(0)
  const [manageOpen, setManageOpen] = useState(false)

  const [formMode, setFormMode] = useState<SubscriberFormMode>(null)
  const [form, setForm] = useState<SubscriberFormState>(emptyForm)
  const [formDirty, setFormDirty] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState("")

  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [renameSaving, setRenameSaving] = useState(false)

  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const firstFieldRef = useRef<HTMLInputElement>(null)
  const formReturnFocusRef = useRef<HTMLElement | null>(null)
  const renameReturnFocusRef = useRef<HTMLElement | null>(null)

  const clearSelectionStorage = () => {
    sessionStorage.removeItem("sirensforge:sirens_mind_creator_reply_selected_subscriber")
    sessionStorage.removeItem("sirensforge:sirens_mind_creator_reply_selected_conversation")
  }

  const saveSelectionStorage = (subscriberId: string, conversationId?: string | null) => {
    sessionStorage.setItem("sirensforge:sirens_mind_creator_reply_selected_subscriber", subscriberId)
    if (conversationId) {
      sessionStorage.setItem("sirensforge:sirens_mind_creator_reply_selected_conversation", conversationId)
    } else {
      sessionStorage.removeItem("sirensforge:sirens_mind_creator_reply_selected_conversation")
    }
  }

  const loadSubscriberList = async (archived: boolean) => {
    const response = await fetch(`/api/sirens-mind/creator-reply/subscribers${archived ? "?archived=true" : ""}`)
    if (!response.ok) throw new Error("SUBSCRIBERS_UNAVAILABLE")
    const payload = await response.json()
    setSubscribers(payload.subscribers)
    return payload.subscribers as Subscriber[]
  }

  useEffect(() => {
    void (async () => {
      try {
        const list = await loadSubscriberList(false)
        const storedSubscriberId = sessionStorage.getItem(
          "sirensforge:sirens_mind_creator_reply_selected_subscriber",
        )
        const storedConversationId = sessionStorage.getItem(
          "sirensforge:sirens_mind_creator_reply_selected_conversation",
        )

        if (!storedSubscriberId) return
        const selected = list.find((subscriber) => subscriber.id === storedSubscriberId)
        if (!selected) {
          clearSelectionStorage()
          return
        }

        const response = await fetch(
          `/api/sirens-mind/creator-reply/subscribers/${selected.id}/conversations`,
        )
        if (!response.ok) {
          clearSelectionStorage()
          return
        }
        const payload = await response.json()
        const conversations = payload.conversations as Conversation[]
        const storedActive = conversations.find(
          (item) => item.id === storedConversationId && item.status === "active",
        )
        const selectedConversation =
          storedActive || conversations.find((item) => item.status === "active") || null

        setActive(selected)
        setConversationList(conversations)
        setConversation(selectedConversation)
        saveSelectionStorage(selected.id, selectedConversation?.id)
      } catch {
        setError("Subscribers could not be loaded.")
      } finally {
        setWorkspaceLoading(false)
      }
    })()
  }, [])

  const finishCloseForm = () => {
    setFormMode(null)
    setFormDirty(false)
    setFormLoading(false)
    setFormSaving(false)
    setFormError("")
    window.setTimeout(() => formReturnFocusRef.current?.focus(), 0)
  }

  const requestCloseForm = () => {
    if (formDirty) {
      setConfirmKind("discard-form")
      return
    }
    finishCloseForm()
  }

  const openNewSubscriber = () => {
    formReturnFocusRef.current = document.activeElement as HTMLElement | null
    setForm(emptyForm())
    setFormDirty(false)
    setFormError("")
    setFormMode("new")
    setLibraryOpen(false)
  }

  const openEditSubscriber = async () => {
    if (!active) return
    formReturnFocusRef.current = document.activeElement as HTMLElement | null
    setManageOpen(false)
    setFormMode("edit")
    setFormLoading(true)
    setFormDirty(false)
    setFormError("")
    try {
      const response = await fetch(`/api/sirens-mind/creator-reply/subscribers/${active.id}`)
      if (!response.ok) throw new Error("SUBSCRIBER_UNAVAILABLE")
      const details = (await response.json()).subscriber as SubscriberDetails
      const knownPlatform = PLATFORMS.includes(details.platform)
      setForm({
        displayName: details.display_name,
        platform: knownPlatform ? details.platform : "Other",
        customPlatform: knownPlatform ? "" : details.platform,
        handle: details.platform_handle || "",
        notes: details.notes || "",
      })
    } catch {
      setFormMode(null)
      setError("Subscriber could not be loaded for editing.")
    } finally {
      setFormLoading(false)
    }
  }

  useEffect(() => {
    if (formMode && !formLoading) firstFieldRef.current?.focus()
  }, [formMode, formLoading])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (confirmKind) {
        setConfirmKind(null)
        return
      }
      if (renameTarget) {
        setRenameTarget(null)
        window.setTimeout(() => renameReturnFocusRef.current?.focus(), 0)
        return
      }
      if (formMode) {
        requestCloseForm()
        return
      }
      if (libraryOpen) {
        setLibraryOpen(false)
        return
      }
      if (manageOpen) setManageOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [confirmKind, renameTarget, formMode, formDirty, libraryOpen, manageOpen])

  const selectSubscriber = async (subscriber: Subscriber) => {
    setError("")
    setManageOpen(false)
    try {
      const response = await fetch(
        `/api/sirens-mind/creator-reply/subscribers/${subscriber.id}/conversations`,
      )
      if (!response.ok) throw new Error("CONVERSATIONS_UNAVAILABLE")
      const payload = await response.json()
      const conversations = payload.conversations as Conversation[]
      const selectedConversation =
        conversations.find((item) => item.status === "active") || null
      setActive(subscriber)
      setConversationList(conversations)
      setConversation(selectedConversation)
      saveSelectionStorage(subscriber.id, selectedConversation?.id)
      setLibraryOpen(false)
      setNotice(
        selectedConversation
          ? `${subscriber.display_name} • ${subscriber.platform} ready.`
          : `${subscriber.display_name} selected. Start or resume a conversation.`,
      )
    } catch {
      setError("Conversations could not be loaded.")
    }
  }

  const saveSubscriber = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (formSaving || formLoading) return
    const finalPlatform =
      form.platform === "Other" ? form.customPlatform.trim() : form.platform.trim()
    if (!form.displayName.trim() || !finalPlatform) {
      setFormError("Name and platform are required.")
      return
    }

    setFormSaving(true)
    setFormError("")
    const body = {
      display_name: form.displayName,
      platform: finalPlatform,
      platform_handle: form.handle,
      notes: form.notes,
    }

    try {
      if (formMode === "new") {
        const response = await fetch("/api/sirens-mind/creator-reply/subscribers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error("SAVE_FAILED")
        const payload = await response.json()
        const subscriber = payload.subscriber as Subscriber
        const nextConversation = payload.conversation as Conversation
        setArchivedView(false)
        setSubscribers((items) => [subscriber, ...items.filter((item) => item.id !== subscriber.id)])
        setActive(subscriber)
        setConversation(nextConversation)
        setConversationList([nextConversation])
        saveSelectionStorage(subscriber.id, nextConversation.id)
        setChatEpoch((value) => value + 1)
        setNotice(`New subscriber started — ${subscriber.display_name} • ${subscriber.platform}`)
      } else if (formMode === "edit" && active) {
        const response = await fetch(`/api/sirens-mind/creator-reply/subscribers/${active.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!response.ok) throw new Error("SAVE_FAILED")
        const updated = (await response.json()).subscriber as Subscriber
        setActive(updated)
        setSubscribers((items) => items.map((item) => (item.id === updated.id ? updated : item)))
        setNotice("Subscriber profile and Key Notes updated.")
      }
      setFormDirty(false)
      finishCloseForm()
    } catch {
      setFormError("Subscriber could not be saved. Your entries were kept.")
    } finally {
      setFormSaving(false)
    }
  }

  const startConversation = async () => {
    if (!active) return
    setManageOpen(false)
    setError("")
    const response = await fetch(
      `/api/sirens-mind/creator-reply/subscribers/${active.id}/conversations`,
      { method: "POST" },
    )
    if (!response.ok) {
      setError("Conversation could not be started.")
      return
    }
    const nextConversation = (await response.json()).conversation as Conversation
    setConversation(nextConversation)
    setConversationList((items) => [
      nextConversation,
      ...items.map((item) => ({ ...item, status: "paused" })),
    ])
    setChatEpoch((value) => value + 1)
    saveSelectionStorage(active.id, nextConversation.id)
    setNotice(`New conversation started with ${active.display_name}.`)
  }

  const resumeConversation = async (target: Conversation) => {
    setError("")
    const response = await fetch(
      `/api/sirens-mind/creator-reply/conversations/${target.id}/resume`,
      { method: "POST" },
    )
    if (!response.ok) {
      setError("Conversation could not be restored.")
      return
    }
    const restored = { ...target, status: "active" }
    setConversation(restored)
    setConversationList((items) =>
      items.map((item) => ({
        ...item,
        status: item.id === target.id ? "active" : item.status === "active" ? "paused" : item.status,
      })),
    )
    setChatEpoch((value) => value + 1)
    if (active) saveSelectionStorage(active.id, target.id)
    setLibraryOpen(false)
    setNotice(`${active?.display_name || "Subscriber"} — ${target.label} restored.`)
  }

  const archiveSubscriber = async () => {
    if (!active) return
    setManageOpen(false)
    const response = await fetch(`/api/sirens-mind/creator-reply/subscribers/${active.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    })
    if (!response.ok) {
      setError("Subscriber could not be archived.")
      return
    }
    setSubscribers((items) => items.filter((item) => item.id !== active.id))
    setActive(null)
    setConversation(null)
    setConversationList([])
    clearSelectionStorage()
    setNotice("Subscriber archived. You can restore them from the library.")
  }

  const showArchived = async (value: boolean) => {
    setArchivedView(value)
    setPlatformFilter("")
    setError("")
    try {
      await loadSubscriberList(value)
    } catch {
      setError("Subscribers could not be loaded.")
    }
  }

  const unarchiveSubscriber = async (subscriber: Subscriber) => {
    const response = await fetch(`/api/sirens-mind/creator-reply/subscribers/${subscriber.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "unarchive" }),
    })
    if (!response.ok) {
      setError("Subscriber could not be restored.")
      return
    }
    setSubscribers((items) => items.filter((item) => item.id !== subscriber.id))
    setNotice(`${subscriber.display_name} restored.`)
  }

  const openRename = (target: Conversation) => {
    renameReturnFocusRef.current = document.activeElement as HTMLElement | null
    setRenameTarget(target)
    setRenameValue(target.label || "")
    setManageOpen(false)
  }

  const closeRename = () => {
    setRenameTarget(null)
    setRenameValue("")
    window.setTimeout(() => renameReturnFocusRef.current?.focus(), 0)
  }

  const saveRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameTarget || renameSaving) return
    setRenameSaving(true)
    const response = await fetch(
      `/api/sirens-mind/creator-reply/conversations/${renameTarget.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: renameValue }),
      },
    )
    if (!response.ok) {
      setRenameSaving(false)
      setError("Conversation could not be renamed.")
      return
    }
    const payload = await response.json()
    const updated = { ...renameTarget, label: payload.conversation.label || "Conversation" }
    setConversationList((items) => items.map((item) => (item.id === updated.id ? updated : item)))
    if (conversation?.id === updated.id) setConversation(updated)
    setNotice("Conversation renamed.")
    setRenameSaving(false)
    closeRename()
  }

  const runReset = async () => {
    if (!conversation) return
    const response = await fetch(
      `/api/sirens-mind/creator-reply/conversations/${conversation.id}/reset`,
      { method: "POST" },
    )
    if (!response.ok) throw new Error("RESET_FAILED")
    setConversation({ ...conversation })
    setChatEpoch((value) => value + 1)
    setNotice("Conversation context reset.")
  }

  const runDelete = async () => {
    if (!active) return
    const response = await fetch(`/api/sirens-mind/creator-reply/subscribers/${active.id}`, {
      method: "DELETE",
    })
    if (!response.ok) throw new Error("DELETE_FAILED")
    setSubscribers((items) => items.filter((item) => item.id !== active.id))
    setActive(null)
    setConversation(null)
    setConversationList([])
    clearSelectionStorage()
    setNotice("Subscriber data deleted.")
  }

  const confirmAction = async () => {
    if (!confirmKind || confirmBusy) return
    if (confirmKind === "discard-form") {
      setConfirmKind(null)
      setFormDirty(false)
      finishCloseForm()
      return
    }

    setConfirmBusy(true)
    try {
      if (confirmKind === "reset-context") await runReset()
      if (confirmKind === "delete-subscriber") await runDelete()
      setConfirmKind(null)
    } catch {
      setError(
        confirmKind === "reset-context"
          ? "Context could not be reset."
          : "Subscriber could not be deleted.",
      )
      setConfirmKind(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const visibleSubscribers = subscribers.filter((subscriber) => {
    const haystack = `${subscriber.display_name} ${subscriber.platform_handle || ""}`.toLowerCase()
    return (
      (!platformFilter || subscriber.platform === platformFilter) &&
      haystack.includes(search.toLowerCase())
    )
  })

  const platformOptions = [...new Set(subscribers.map((subscriber) => subscriber.platform))]

  const confirmCopy =
    confirmKind === "discard-form"
      ? {
          title: "Discard the subscriber information you entered?",
          body: "These changes have not been saved.",
          action: "Discard Changes",
        }
      : confirmKind === "reset-context"
        ? {
            title: "Reset this conversation?",
            body: "This destroys the saved resume point for the current conversation. The subscriber profile and Key Notes are kept.",
            action: "Reset Context",
          }
        : {
            title: `Delete ${active?.display_name || "subscriber"}?`,
            body: "This permanently deletes the subscriber and every saved conversation. This cannot be undone.",
            action: "Delete Subscriber",
          }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[#05060a]" />
        <div className="absolute inset-y-0 left-0 w-[28rem] bg-[radial-gradient(circle_at_left,rgba(168,85,247,0.13),transparent_70%)]" />
        <div className="absolute right-0 top-0 h-[26rem] w-[34rem] bg-[radial-gradient(circle_at_top_right,rgba(236,72,153,0.08),transparent_68%)]" />
        <div className="absolute bottom-0 right-0 h-[28rem] w-[32rem] bg-[radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.08),transparent_68%)]" />
      </div>

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[78rem] flex-col px-4 pb-5 pt-4 sm:px-6 sm:pb-6 sm:pt-6">
        <header className="mb-4 flex shrink-0 flex-col gap-4 border-l-2 border-fuchsia-400/40 pl-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-pink-300 bg-clip-text text-[28px] font-semibold tracking-tight text-transparent sm:text-[32px]">
              Creator Reply
            </h1>
            <p className="mt-2 text-[12px] uppercase tracking-[0.16em] text-zinc-500 sm:text-[13px]">
              Paste what they said. Get what to send.
            </p>
          </div>

          <nav className="flex flex-wrap gap-2 sm:justify-end" aria-label="Creator Reply controls">
            <button
              type="button"
              onClick={() => {
                setLibraryOpen(true)
                setManageOpen(false)
              }}
              className={secondaryPill}
            >
              Subscribers
            </button>
            <button type="button" onClick={openNewSubscriber} className={primaryPill}>
              + New Subscriber
            </button>
          </nav>
        </header>

        {(notice || error) && (
          <div className="mb-3 flex shrink-0 justify-end" aria-live="polite">
            {notice && !error ? (
              <p
                role="status"
                className="rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-4 py-2 text-[11px] font-medium text-emerald-200/90"
              >
                {notice}
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="rounded-full border border-red-400/20 bg-red-500/[0.08] px-4 py-2 text-[11px] font-medium text-red-200"
              >
                {error}
              </p>
            ) : null}
          </div>
        )}

        {workspaceLoading ? (
          <section className="flex flex-1 items-center justify-center py-14">
            <div className="rounded-[24px] border border-white/10 bg-white/[0.025] px-8 py-7 text-center shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
              <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-fuchsia-300/20 border-t-fuchsia-300" />
              <p className="mt-4 text-[12px] uppercase tracking-[0.16em] text-zinc-500">
                Loading Creator Reply
              </p>
            </div>
          </section>
        ) : !active ? (
          <section className="flex flex-1 items-center justify-center py-12 sm:py-20">
            <div className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,12,18,0.90),rgba(7,8,12,0.88))] p-7 shadow-[0_28px_90px_rgba(0,0,0,0.45)] sm:p-9">
              <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-fuchsia-500/10 blur-3xl" />
              <div className="relative">
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300/70">
                  Creator Reply Workspace
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  Ready for a subscriber
                </h2>
                <p className="mt-3 max-w-xl text-[14px] leading-7 text-zinc-400">
                  Choose somebody from your library or start a new subscriber. Their notes and
                  conversation continuity stay private and encrypted.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button type="button" onClick={() => setLibraryOpen(true)} className={secondaryPill}>
                    Choose Subscriber
                  </button>
                  <button type="button" onClick={openNewSubscriber} className={primaryPill}>
                    + New Subscriber
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <section
              aria-label="Active subscriber"
              className="mb-3 shrink-0 rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,12,18,0.82),rgba(8,9,13,0.78))] px-4 py-4 shadow-[0_18px_50px_rgba(0,0,0,0.24)] sm:px-5"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="text-[16px] font-semibold text-white">{active.display_name}</strong>
                    <span className="text-zinc-600">•</span>
                    <span className="text-[13px] font-medium text-fuchsia-200/90">{active.platform}</span>
                    {active.platform_handle ? (
                      <>
                        <span className="text-zinc-600">•</span>
                        <span className="truncate text-[13px] text-zinc-400">
                          @{active.platform_handle.replace(/^@/, "")}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
                    <span>{conversation ? conversation.label || "Current conversation" : "No active conversation"}</span>
                    {conversation ? (
                      <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-300/80">
                        Active
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={startConversation} className={secondaryPill}>
                    + New Conversation
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      aria-expanded={manageOpen}
                      aria-haspopup="menu"
                      onClick={() => setManageOpen((value) => !value)}
                      className={secondaryPill}
                    >
                      Manage
                    </button>
                    {manageOpen ? (
                      <div
                        role="menu"
                        className="absolute right-0 top-12 z-30 w-60 overflow-hidden rounded-2xl border border-white/10 bg-[#0b0c11]/98 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={openEditSubscriber}
                          className="w-full rounded-xl px-3 py-2.5 text-left text-[12px] text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
                        >
                          Edit Subscriber
                        </button>
                        {conversation ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => openRename(conversation)}
                            className="w-full rounded-xl px-3 py-2.5 text-left text-[12px] text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
                          >
                            Rename Conversation
                          </button>
                        ) : null}
                        {conversation ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setManageOpen(false)
                              setConfirmKind("reset-context")
                            }}
                            className="w-full rounded-xl px-3 py-2.5 text-left text-[12px] text-amber-200/80 transition hover:bg-amber-400/[0.07] hover:text-amber-100"
                          >
                            Reset Context
                          </button>
                        ) : null}
                        <div className="my-1 border-t border-white/10" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={archiveSubscriber}
                          className="w-full rounded-xl px-3 py-2.5 text-left text-[12px] text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
                        >
                          Archive Subscriber
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setManageOpen(false)
                            setConfirmKind("delete-subscriber")
                          }}
                          className="w-full rounded-xl px-3 py-2.5 text-left text-[12px] text-red-300/80 transition hover:bg-red-500/[0.08] hover:text-red-200"
                        >
                          Delete Subscriber
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            {conversation ? (
              <section className="min-h-[32rem] flex-1 overflow-hidden rounded-[26px] border border-white/10 bg-black/30 shadow-[0_24px_80px_rgba(0,0,0,0.30)]">
                <ChatUI
                  key={`${active.id}:${conversation.id}:${chatEpoch}`}
                  experience="creator_reply"
                  subscriberId={active.id}
                  conversationId={conversation.id}
                  embedded
                />
              </section>
            ) : (
              <section className="flex min-h-[28rem] flex-1 items-center justify-center rounded-[26px] border border-white/10 bg-white/[0.02] p-7 text-center">
                <div className="max-w-lg">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.20em] text-cyan-300/70">
                    Subscriber selected
                  </div>
                  <h2 className="mt-3 text-xl font-semibold text-white">Choose how to continue</h2>
                  <p className="mt-2 text-[14px] leading-7 text-zinc-400">
                    Resume a saved conversation from the Subscribers panel or start a clean conversation with {active.display_name}.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <button type="button" onClick={() => setLibraryOpen(true)} className={secondaryPill}>
                      Saved Conversations
                    </button>
                    <button type="button" onClick={startConversation} className={primaryPill}>
                      + New Conversation
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {libraryOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close subscriber library"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setLibraryOpen(false)}
          />
          <aside
            aria-label="Subscriber library"
            className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[#08090e]/98 shadow-[-30px_0_90px_rgba(0,0,0,0.50)] backdrop-blur-2xl"
          >
            <div className="border-b border-white/10 px-5 py-5 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300/70">
                    Private Library
                  </div>
                  <h2 className="mt-1 text-2xl font-semibold text-white">Subscribers</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-xl text-zinc-400 transition hover:border-white/20 hover:text-white"
                  aria-label="Close subscriber library"
                >
                  ×
                </button>
              </div>

              <div className="mt-5 flex rounded-full border border-white/10 bg-black/30 p-1">
                <button
                  type="button"
                  aria-pressed={!archivedView}
                  onClick={() => void showArchived(false)}
                  className={`flex-1 rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    !archivedView ? "bg-fuchsia-500/15 text-fuchsia-200" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Active
                </button>
                <button
                  type="button"
                  aria-pressed={archivedView}
                  onClick={() => void showArchived(true)}
                  className={`flex-1 rounded-full px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    archivedView ? "bg-fuchsia-500/15 text-fuchsia-200" : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Archived
                </button>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_10rem]">
                <input
                  aria-label="Search subscribers"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or handle..."
                  className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-fuchsia-400/30"
                />
                <select
                  aria-label="Filter platform"
                  value={platformFilter}
                  onChange={(event) => setPlatformFilter(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-[#0d0e13] px-3 py-3 text-[12px] text-zinc-300 outline-none focus:border-fuchsia-400/30"
                >
                  <option value="">All platforms</option>
                  {platformOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="space-y-2">
                {visibleSubscribers.length ? (
                  visibleSubscribers.map((subscriber) => {
                    const selected = active?.id === subscriber.id
                    return (
                      <div
                        key={subscriber.id}
                        className={`rounded-2xl border p-1 transition ${
                          selected
                            ? "border-fuchsia-400/25 bg-fuchsia-500/[0.07]"
                            : "border-white/8 bg-white/[0.02] hover:border-white/15"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={archivedView}
                            onClick={() => void selectSubscriber(subscriber)}
                            className="min-w-0 flex-1 rounded-xl px-3 py-3 text-left disabled:cursor-default"
                          >
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[14px] font-semibold text-white">
                                {subscriber.display_name}
                              </span>
                              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-fuchsia-300/70">
                                {subscriber.platform}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                              {subscriber.platform_handle ? (
                                <span>@{subscriber.platform_handle.replace(/^@/, "")}</span>
                              ) : null}
                              <span>{formatLastUsed(subscriber.last_used_at)}</span>
                            </div>
                          </button>
                          {archivedView ? (
                            <button
                              type="button"
                              onClick={() => void unarchiveSubscriber(subscriber)}
                              className="mr-2 rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:border-fuchsia-300/30 hover:text-white"
                            >
                              Unarchive
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 px-5 py-8 text-center text-[13px] text-zinc-500">
                    No subscribers match this view.
                  </div>
                )}
              </div>

              {!archivedView && active ? (
                <section className="mt-6 border-t border-white/10 pt-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/65">
                        Saved Conversations
                      </div>
                      <div className="mt-1 text-[13px] text-zinc-400">{active.display_name}</div>
                    </div>
                    <button type="button" onClick={startConversation} className={secondaryPill}>
                      + New
                    </button>
                  </div>

                  <div className="mt-3 space-y-2">
                    {conversationList.length ? (
                      conversationList.map((item) => {
                        const isCurrent = conversation?.id === item.id && item.status === "active"
                        return (
                          <div
                            key={item.id}
                            className={`rounded-2xl border px-4 py-3 ${
                              isCurrent
                                ? "border-cyan-400/20 bg-cyan-400/[0.05]"
                                : "border-white/8 bg-white/[0.02]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-medium text-zinc-200">
                                  {item.label || "Conversation"}
                                </div>
                                <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                                  {isCurrent ? "Active" : item.status} • {formatLastUsed(item.last_used_at)}
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() => openRename(item)}
                                  className="rounded-full border border-white/10 px-3 py-1.5 text-[10px] font-medium text-zinc-400 transition hover:text-white"
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  disabled={isCurrent}
                                  onClick={() => void resumeConversation(item)}
                                  className="rounded-full border border-fuchsia-300/20 px-3 py-1.5 text-[10px] font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/10 disabled:cursor-default disabled:opacity-40"
                                >
                                  {isCurrent ? "Active" : "Resume"}
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-[12px] text-zinc-500">
                        No saved conversations yet.
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {formMode ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscriber-form-title"
            className="relative max-h-[90dvh] w-full max-w-2xl overflow-x-hidden overflow-y-auto rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,15,21,0.98),rgba(8,9,13,0.98))] p-5 shadow-[0_30px_100px_rgba(0,0,0,0.60)] sm:p-7"
          >
            <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-fuchsia-500/10 blur-3xl" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-fuchsia-300/70">
                    Subscriber Memory
                  </div>
                  <h2 id="subscriber-form-title" className="mt-1 text-2xl font-semibold text-white">
                    {formMode === "new" ? "New Subscriber" : "Edit Subscriber"}
                  </h2>
                  <p className="mt-2 max-w-lg text-[13px] leading-6 text-zinc-500">
                    {formMode === "new"
                      ? "Create a private subscriber profile and start a clean conversation."
                      : "Update the subscriber profile without changing their saved conversations."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={requestCloseForm}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-xl text-zinc-400 transition hover:text-white"
                  aria-label="Close subscriber form"
                >
                  ×
                </button>
              </div>

              {formLoading ? (
                <div className="flex min-h-64 items-center justify-center">
                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-fuchsia-300/20 border-t-fuchsia-300" />
                </div>
              ) : (
                <form onSubmit={saveSubscriber} className="mt-6 space-y-5">
                  <label className="block text-[12px] font-medium text-zinc-300">
                    Name
                    <input
                      ref={firstFieldRef}
                      required
                      maxLength={120}
                      value={form.displayName}
                      onChange={(event) => {
                        setForm((value) => ({ ...value, displayName: event.target.value }))
                        setFormDirty(true)
                      }}
                      className={fieldClass}
                      placeholder="Subscriber name or nickname"
                    />
                  </label>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block text-[12px] font-medium text-zinc-300">
                      Platform
                      <select
                        required
                        value={form.platform}
                        onChange={(event) => {
                          setForm((value) => ({ ...value, platform: event.target.value }))
                          setFormDirty(true)
                        }}
                        className={`${fieldClass} bg-[#0d0e13]`}
                      >
                        {PLATFORMS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-[12px] font-medium text-zinc-300">
                      Handle / Username
                      <input
                        maxLength={120}
                        value={form.handle}
                        onChange={(event) => {
                          setForm((value) => ({ ...value, handle: event.target.value }))
                          setFormDirty(true)
                        }}
                        className={fieldClass}
                        placeholder="Optional"
                      />
                    </label>
                  </div>

                  {form.platform === "Other" ? (
                    <label className="block text-[12px] font-medium text-zinc-300">
                      Custom platform
                      <input
                        required
                        maxLength={80}
                        value={form.customPlatform}
                        onChange={(event) => {
                          setForm((value) => ({ ...value, customPlatform: event.target.value }))
                          setFormDirty(true)
                        }}
                        className={fieldClass}
                        placeholder="Platform name"
                      />
                    </label>
                  ) : null}

                  <label className="block text-[12px] font-medium text-zinc-300">
                    Key Notes
                    <textarea
                      maxLength={2000}
                      rows={6}
                      value={form.notes}
                      onChange={(event) => {
                        setForm((value) => ({ ...value, notes: event.target.value }))
                        setFormDirty(true)
                      }}
                      className={`${fieldClass} resize-y leading-6`}
                      placeholder="Preferences, ongoing dynamics, roleplay context, or details Siren should remember..."
                    />
                    <span className="mt-2 block text-[11px] font-normal leading-5 text-zinc-600">
                      Useful details Siren should remember about this subscriber, preferences, ongoing dynamics, or roleplay context.
                    </span>
                  </label>

                  {formError ? (
                    <p
                      role="alert"
                      className="rounded-2xl border border-red-400/15 bg-red-500/[0.06] px-4 py-3 text-[12px] text-red-200"
                    >
                      {formError}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-5">
                    <button type="button" onClick={requestCloseForm} className={secondaryPill}>
                      Cancel
                    </button>
                    <button type="submit" disabled={formSaving} className={primaryPill}>
                      {formSaving
                        ? "Saving…"
                        : formMode === "new"
                          ? "Save Subscriber"
                          : "Save Changes"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {renameTarget ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-conversation-title"
            className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#0b0c11] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.60)]"
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.20em] text-fuchsia-300/70">
              Saved Conversation
            </div>
            <h2 id="rename-conversation-title" className="mt-1 text-xl font-semibold text-white">
              Rename Conversation
            </h2>
            <form onSubmit={saveRename} className="mt-5">
              <label className="block text-[12px] font-medium text-zinc-300">
                Conversation label
                <input
                  autoFocus
                  maxLength={160}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  className={fieldClass}
                  placeholder="Bartender snowstorm"
                />
              </label>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={closeRename} className={secondaryPill}>
                  Cancel
                </button>
                <button type="submit" disabled={renameSaving} className={primaryPill}>
                  {renameSaving ? "Saving…" : "Save Name"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {confirmKind ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="creator-reply-confirm-title"
            className="w-full max-w-md rounded-[24px] border border-red-400/15 bg-[#0b0c11] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.20em] text-red-300/70">
              Confirm Action
            </div>
            <h2 id="creator-reply-confirm-title" className="mt-1 text-xl font-semibold text-white">
              {confirmCopy.title}
            </h2>
            <p className="mt-3 text-[13px] leading-6 text-zinc-400">{confirmCopy.body}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => setConfirmKind(null)}
                className={secondaryPill}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={confirmBusy}
                onClick={() => void confirmAction()}
                className="rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {confirmBusy ? "Working…" : confirmCopy.action}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
