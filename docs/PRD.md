# Product Requirements Document
## AI-Powered Micro-CRM for Small Business Owners

---

**Version:** 1.2
**Status:** Draft
**Author:** Ritik
**Last Updated:** August 2026

---

## 1. Problem Statement

Small business owners manage relationships with dozens of prospects and customers — but they do it manually. They scan through email threads, spreadsheet notes, and memory to figure out who they last spoke to, what was discussed, and what needs to happen next.

This process is slow, error-prone, and mentally exhausting. Deals go cold because no one followed up. Expansion opportunities are missed because the signal was buried in old notes. Customers feel neglected not because the owner doesn't care — but because there's too much to keep track of.

**The core problem:** A small business owner should never have to wonder *"who should I reach out to today?"* — but they do, every day.

---

## 2. Goal

Build a simple, AI-powered tool that acts as a smart relationship manager — one that reads all the context and tells the user exactly who needs attention, why, and what to do about it. With zero manual analysis.

---

## 3. Target User

**Primary user:** A small business owner or solo account manager who:
- Manages 5–50 active customer and prospect relationships
- Currently tracks interactions in a spreadsheet, notes app, or from memory
- Loses deals or expansion opportunities due to lack of follow-up visibility
- Doesn't need a full CRM — just clarity on what to do next

---

## 4. Goals and Non-Goals

### Goals
- Surface the right follow-ups at the right time — without the user having to ask
- Give the user enough context per relationship to act immediately
- Reduce the mental effort of pipeline management to near zero
- Allow the user to ask freeform questions about their pipeline and get real, data-grounded answers
- Let the user log new interactions and add new companies with minimal friction — via chat or a quick form

### Non-Goals
- This is not a full CRM replacement (no deal stages, pipelines, revenue tracking)
- This is not a communication tool (no sending emails from inside the app)
- This is not a team collaboration tool (single user, single owner)
- This is not a contact book or database management tool

---

## 5. User Stories

**As a small business owner, I want to...**

1. Open the app and immediately know who I need to follow up with today — without reviewing notes or emails myself.

2. See a clear, specific action I should take for each relationship — not a vague reminder like "follow up."

3. Get a ready-to-send draft message for any company — so following up takes seconds, not minutes.

4. Log a new interaction after a call or email — so the AI's advice stays current and reflects what actually happened.

5. Ask free-form questions about my pipeline — like *"which deals haven't heard from me in two weeks?"* or *"which customers are at risk?"* — and get an accurate, grounded answer.

6. Add a new company or log an interaction by just telling the AI — without filling out a form.

---

## 6. Features

### Feature 1 — Priority Dashboard *(Core)*

The first and only screen. No setup, no empty state. The app has already analysed every relationship and surfaced what matters.

**What the user sees:**

A summary bar at the top:
> *4 Prospects · 4 Customers · 3 Need Attention*

Below it, a ranked list of all companies ordered by urgency. Each card shows:
- **Urgency badge** — one of four states: Hot / Watch / Stable / Stale
- **One-line AI reason** — why this company is at this urgency level right now
- **Recommended action** — one specific, concrete next step
- **Last contact date**
- **"+ Log" button** — opens a 3-field quick form directly on the card

**How urgency is determined:**
- **🔴 Hot** — a time-sensitive commitment was made but not acted on, or a large deal is going quiet
- **🟡 Watch** — an unanswered question, slow response, or competitor risk is present
- **🟢 Stable** — a clear next step with a known timeline, nothing urgent
- **⚫ Stale** — no meaningful contact in 60+ days, relationship at risk of dying

**Expandable card state:**
Clicking a company card expands it inline — no separate page. The expanded state shows:
- **AI Relationship Brief** — 2–3 sentences on where the relationship stands right now
- **The Blocker** — the single thing preventing progress
- **Next Best Action** — one specific recommendation with full context
- **Draft Message button** — generates a ready-to-send follow-up, streamed in real time

**User benefit:** The user opens the app and knows what to do in under 10 seconds. Expanding a card gives them everything they need to act — without leaving the screen.

---

### Feature 2 — Quick Log Form *(Core)*

Each company card has a **"+ Log"** button. Clicking it opens a minimal 3-field form anchored to that card. Company is pre-filled — the user only fills in three things:

| Field | Input |
|---|---|
| Contact | Dropdown — contacts at this company |
| Type | Dropdown — Meeting / Email / Call / Demo |
| Notes | Text area — what happened |

**Save + Reanalyse:**
Saving writes the interaction to the database and immediately reruns AI priority scoring for that company. The card updates — new urgency badge, new reason, new recommended action — in real time.

This is the "obvious" path for logging. The user doesn't need to know anything about the chat to use it.

---

### Feature 3 — Pipeline Chat *(Core)*

A chat interface alongside the dashboard. Powered by an AI agent with tools that read from and write to the database. The agent writes SQL queries based on the user's question — it doesn't scan everything blindly. It narrows scope based on context:

```
"What's the situation with Northstar Labs?"  →  queries Northstar Labs only
"Which deals are at risk?"                   →  queries all companies
"When did I last speak with Lisa?"           →  queries by contact name
```

**What the agent can do:**

*Read tools:*
- Query companies, contacts, and interactions by any dimension
- Answer questions about the pipeline — urgency, recency, status, specific contacts

*Write tools:*
- `insert_interaction` — logs a new interaction when the user describes one in natural language
- `insert_company` — adds a new company when the user provides the details

**Guardrail — agent cannot modify or delete existing records.** Only inserts are permitted. This is a deliberate safety decision: corrupting historical interaction data would silently break AI advice. Stated explicitly in the README.

**Example interactions:**

> *"Just got off a call with Tom — IT review is scheduled for Aug 20"*
> → Agent logs the interaction, reruns scoring for UrbanFleet, responds: *"Logged. UrbanFleet updated to Watch — follow up after Aug 20."*

> *"Add Horizon Tech as a new prospect — SaaS company, 60 employees"*
> → Agent inserts company, confirms.

> *"Which deals are at risk of going cold?"*
> → Agent queries interaction recency + status, responds with a grounded list.

**User benefit:** The user can ask anything about their pipeline and get a real answer. They can also log interactions and add companies just by typing — no form required. Chat is the power-user path; the "+ Log" button is the discoverable path. Both write to the same place.

---

## 7. Future Scope

The following are intentionally excluded from this version. Each is a valid next feature:

| Feature | Notes |
|---|---|
| Company detail page | Full interaction timeline, deep AI brief, all contacts |
| Editing existing interactions | Inline edit with reanalysis trigger |
| Deleting interactions | Requires audit trail to avoid silently corrupting AI advice |
| Adding / editing contacts | Admin/settings view in production |
| Sending emails from the app | Requires email integration (Gmail API, etc.) |
| User authentication | Out of scope — single-owner tool for this version |
| Revenue / deal value tracking | Data model doesn't support it yet |
| Notifications and reminders | Scheduled jobs, push notifications — separate system |
| Mobile app | Web only for this version |

---

## 8. User Flows

### Flow 1 — Daily Check-in *(Primary)*
```
User opens app
  → Dashboard loads, AI has already ranked all companies
  → User scans badges and one-line reasons
  → Spots UrbanFleet — Hot — "Tom's reconnect window has passed"
  → Clicks card → expands inline
  → Reads AI brief + blocker + next action
  → Clicks "Draft Message" → message streams in
  → Copies and sends from their email client
  → Done in under 2 minutes
```

### Flow 2 — Log via Chat *(Power-user path)*
```
User finishes a call with Tom Wilson
  → Types in chat: "Just spoke with Tom — IT review scheduled for Aug 20"
  → Agent identifies this as a new interaction
  → Calls insert_interaction tool
  → Writes to DB
  → Reruns priority scoring for UrbanFleet
  → Responds: "Logged. UrbanFleet updated to Watch — follow up after Aug 20."
  → Dashboard card updates in real time
```

### Flow 3 — Log via Quick Form *(Discoverable path)*
```
User finishes a call with Tom Wilson
  → Clicks "+ Log" on the UrbanFleet card
  → Selects Tom Wilson → Call → types notes
  → Clicks "Save + Reanalyse"
  → Card urgency badge updates immediately
  → User sees AI has understood and adjusted its advice
```

### Flow 4 — Pipeline Question
```
User types: "Which customers are good candidates for expansion?"
  → Agent queries customers + recent interaction notes
  → Identifies signals: Northstar Labs (40→70 users), Bluebird Health (frozen budget but interested)
  → Responds with grounded list and one-line context per company
```

### Flow 5 — Add New Company via Chat
```
User types: "Add Horizon Tech — SaaS prospect, 60 employees, contact is Raj Mehta, CTO"
  → Agent parses details
  → Calls insert_company + insert_contact tools
  → Confirms: "Horizon Tech added as a prospect. Raj Mehta saved as CTO contact."
  → Company appears on dashboard as Stale (no interactions yet)
```

---

## 9. Success Metrics

Success for this version is measured qualitatively:

| Metric | What good looks like |
|---|---|
| Time to first insight | User knows their top priority within 10 seconds of opening the app |
| AI accuracy | Every urgency label and reason is defensible from the actual data |
| Action specificity | Every recommended action is specific enough to act on without thinking |
| Draft quality | Draft messages require minimal editing before sending |
| Chat accuracy | Agent answers are factually correct and grounded — no hallucinated context |
| Log feedback loop | After logging an interaction, the dashboard visibly updates with new AI advice |

---

## 10. Design Principles

**Proactive over reactive.** The app tells the user what matters before they ask. A tool that only answers questions is less valuable than one that already read everything.

**Specific over generic.** "Follow up with David" is useless. "David said he's still discussing internally — check in referencing the implementation plan you sent Jul 11" is actionable. Every AI output must be specific enough to act on immediately.

**Two paths, one outcome.** Every action has a discoverable UI path (button, form) and a chat path (natural language). Users who don't know about the chat still get the full experience. Power users move faster.

**Write safety.** The AI agent can only insert — never modify or delete existing records. Historical interaction data is the foundation of every AI recommendation. Corrupting it silently breaks the whole product.

**Less is more.** Three deeply useful features beat ten shallow ones. Every feature must meaningfully reduce the user's mental effort or it doesn't ship.

---

## 11. Open Questions

1. Should the draft message include a subject line (email format) or be a plain short message?
2. Should the pipeline chat maintain conversation history within a session, or treat each message as independent?
3. Should the dashboard urgency scores refresh automatically on a timer, or only after a new interaction is logged?

---

*End of Document — v1.2*