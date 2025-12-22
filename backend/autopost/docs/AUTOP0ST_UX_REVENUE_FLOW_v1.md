# AUTOPost UX + Revenue-Share Flow (v1)

Status: LOCKED  
Phase: 2 (Documentation-only, offline-safe)

This document defines how Autopost presents itself to users and
how revenue-share metadata is attached and propagated.
No Stripe writes. No Supabase runtime execution.

---

## 1) Core UX Principle

Autopost UX is:
- Transparent
- Predictable
- Non-blocking
- Revenue-aware but not revenue-executing

Autopost NEVER:
- Calculates payouts
- Shows money balances
- Triggers billing
- Modifies creator earnings

---

## 2) Primary UX Surfaces (Phase 2)

### A) Autopost Dry-Run / Preview
Purpose:
- Validate what WOULD be posted
- Show selection logic clearly
- No side effects

Shows:
- Selected caption
- CTA (if available)
- Hashtags (if available)
- Platform target
- Explicitness level
- Cooldown applied
- Revenue split (80/20)

Never shows:
- Stripe IDs
- Dollar amounts
- Earnings projections

---

### B) Autopost Ready State
Purpose:
- Confirm content is publishable

States:
- READY (full package)
- READY (caption-only)
- BLOCKED (no eligible content)

READY (caption-only) is NOT an error.

---

### C) Autopost Blocked State
Purpose:
- Explain why nothing can post

Shows:
- Status: BLOCKED
- Reason code (F001)
- Human-readable explanation:
  “No eligible captions meet your current rules.”

Suggested actions:
- Add new approved content
- Adjust cooldown window
- Adjust explicitness comfort

No auto-actions.

---

## 3) Revenue-Share Model (LOCKED)

Autopost attaches revenue metadata to EVERY payload:

```json
{
  "revenue_share": {
    "creator_pct": 0.8,
    "sirensforge_pct": 0.2
  }
}
