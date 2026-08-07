# WhatsApp Outreach Campaign — Ikan Group

Automation for reaching business leads on WhatsApp: import a CSV lead list, send an
approved first-touch template, let an AI (styled as "John from Ikan Group") carry the
conversation through a niche-specific pitch, flag hot leads for hand-off, and monitor
everything from a custom WhatsApp-style inbox — since the sending number can't be
logged into a normal WhatsApp client at the same time it's running automation.

## Before you scale this up

WhatsApp's messaging tiers (250 → 1K → 10K → 100K unique users/24h) govern how many
people you can reach with **approved Message Templates** — they are not a green light
to cold-blast a scraped list. Meta tracks block/report rate per number regardless of
tier, and a fresh number sending unsolicited templates at volume typically gets
flagged or restricted within hours to days. The system below is built with that in
mind (daily cap, randomized pacing, opt-out handling, low-pressure first-touch
message) — but no amount of engineering removes the underlying platform risk of
cold outreach. Treat the caps in Settings as a ceiling to *raise cautiously* while
watching your number's quality rating in Meta Business Manager, not a target to hit
immediately.

## Architecture

```
Google Sheets/CSV ──▶  Leads page (app)  ──▶  Supabase (leads, conversations, messages, events)
                                                        ▲                    │
                                                        │                    ▼
                                          n8n: WA Outbound          n8n: WA Inbound
                                          (scheduled sender)        (webhook + AI reply)
                                                        │                    │
                                                        ▼                    ▼
                                                   WhatsApp Cloud API (Meta)
                                                        │
                                                        ▼
                                              Business owner's phone
```

- **`/app`** — Vite + React + TypeScript dashboard: WhatsApp-style inbox (realtime),
  CSV lead import/export, campaign settings, message template editor. Talks directly
  to Supabase (anon key + row-level security) for reads/writes, and to n8n (via a
  webhook) only to send a manually-typed message.
- **Supabase project `whatsapp-outreach-campaign`** (`uqnqcywnileazxirzyxv`) — schema
  for `niches`, `leads`, `conversations`, `messages`, `events`, `message_templates`,
  `campaign_settings`, plus a `conversation_list` view the inbox reads from.
- **`/n8n-workflows`** — source for two n8n workflows (also already created in your
  n8n instance as drafts, inactive):
  - `outbound-first-touch.ts` — **WA Outbound — First-Touch Sender**: scheduled, reads
    pacing settings, sends the approved first-touch template to queued leads with
    randomized delays between sends, logs everything, marks non-WhatsApp numbers.
  - `inbound-reply-handler.ts` — **WA Inbound — Reply Handler**: WhatsApp webhook,
    logs every inbound message, respects manual takeover and opt-out keywords,
    classifies replies with OpenAI (confirm/interested/not interested/other) and
    drafts a short, casual, human-sounding reply, sends the niche pitch + PDF offer,
    and raises a `hot_lead` event the dashboard picks up in realtime.

Nothing is activated yet — this is deliberate. See **Setup** below.

## Setup

### 1. Meta / WhatsApp Business Platform

1. In [Meta Business Manager](https://business.facebook.com), confirm your business
   is verified and you have a WhatsApp Business Account (WABA) with a phone number
   attached.
2. Create a **System User** (Business Settings → Users → System Users) with admin
   access to the WABA, and generate a **permanent access token** for it
   (`whatsapp_business_messaging`, `whatsapp_business_management` scopes).
3. Note your **phone_number_id** and **WABA ID** (Business Settings → Accounts →
   WhatsApp Accounts).
4. Submit your **first-touch template** for approval (Business Manager → Account
   tools → Message Templates). Keep it short, low-pressure, and honest about who's
   messaging — e.g.:
   > Hi, is this {{1}}? I help small businesses get set up online — quick question
   > if you have a sec.
   Approval usually takes minutes to a couple of days. You cannot send template
   messages until it's approved.

### 2. n8n

Two workflows already exist in your n8n instance as **inactive drafts**:
[WA Outbound — First-Touch Sender](https://n8n.remoten8n.duckdns.org/workflow/z3KarZgzcxfB1azz)
and
[WA Inbound — Reply Handler](https://n8n.remoten8n.duckdns.org/workflow/If8jiQRRvIm6Zyks).
Each has a sticky note on the canvas listing what to configure. In short:

1. **Fix the Supabase credential first** (flagged with a red warning sticky on both
   workflows) — every Supabase node got auto-assigned an existing credential that
   points at a *different* Supabase project. Create a new credential in n8n named
   e.g. `WhatsApp Campaign Supabase`:
   - URL: `https://uqnqcywnileazxirzyxv.supabase.co`
   - API key: the **service_role** key from Supabase Dashboard → this project →
     Project Settings → API (not the anon key — n8n needs to bypass row-level
     security).
   Then open each Supabase node in both workflows and select this credential.
2. **WhatsApp Cloud API credential** — new credential using the System User access
   token from step 1.
3. **WhatsApp Trigger credential** (inbound workflow only) — your Meta App's
   Client ID + Secret. There's no manual "verify token" field to fill in on Meta's
   side; n8n handles webhook verification automatically once the trigger node is
   active — Meta's app dashboard will ask for a verify token/URL when you subscribe
   the webhook, and n8n's node exposes what to enter there.
4. Set `phoneNumberId` (currently a placeholder) on the **Send First-Touch Template**
   node (outbound) and it's read automatically from the webhook payload on the
   inbound workflow's send nodes — verify that once you've sent a real test message.
5. **Test the inbound payload shape once for real.** The "Normalize Inbound Message"
   node guesses at Meta's standard webhook JSON shape. Send yourself one WhatsApp
   message after activating the trigger, open the execution in n8n, and confirm
   `phoneE164` / `inboundBody` populated. Adjust the expression if not — Meta's
   webhook nesting varies slightly by API version.
6. Only **activate** (publish) both workflows once 1–5 are done.

### 3. Supabase

Already provisioned — nothing to do here unless you want to review it:
[Supabase project dashboard](https://supabase.com/dashboard/project/uqnqcywnileazxirzyxv).
The schema, RLS policies, and realtime publication are already applied.

To sign in to the dashboard app, create your account via its own signup form (see
below) — Supabase Auth, not a separate admin panel.

### 4. The dashboard app (`/app`)

```bash
cd app
cp .env.example .env.local   # fill in VITE_SUPABASE_ANON_KEY from Supabase dashboard
npm install
npm run dev
```

Open the printed local URL, click **"Create the owner account"** on first run to set
up your login (Supabase Auth — email/password), then sign in.

To let the "Send" box in a conversation actually deliver a manual message, set
`VITE_N8N_MANUAL_SEND_WEBHOOK_URL` in `.env.local`. That webhook doesn't exist yet —
it's a small third workflow (webhook → WhatsApp send → log to Supabase) you can add
in n8n following the same pattern as the other two; until then, manual sends will
show a clear inline error instead of failing silently.

Deploy (`npm run build`, then any static host — Vercel/Netlify/Cloudflare Pages all
work fine) once you're past local testing.

### 5. Content to fill in before the first real send

In the app's **Settings** page:
- Add a **niche** for each business category in your lead list.
- Add a **first_touch** template row per niche (or one generic, `niche = none`) with
  the exact `meta_template_name` you got approved in step 1.
- Add **pitch** template rows (free-form, no Meta approval needed — these are only
  sent after the contact replies, inside the 24h customer-service window).
- Add **offer** template rows whose `body` is a public URL to your PDF one-pager per
  niche — that's what "Send Offer PDF" sends.
- Review the daily cap / send-window / jitter defaults (100/day, 9am–6pm
  Africa/Lagos, 25–180s between sends) and adjust conservatively.

Then go to **Leads**, import your CSV, and once the n8n workflows are activated,
sending begins on the next scheduled run (every 10 minutes, within the send window).

## How a lead flows through the system

1. CSV import → `leads` row, `status = queued`.
2. Outbound workflow sends the approved first-touch template, `status = sent`, a
   `conversations` row is created (`stage = awaiting_confirmation`).
3. Contact replies → inbound workflow logs it, AI classifies:
   - **confirms it's them** → pitch sent, PDF offer sent, `stage = pitched`.
   - **says it's the wrong number** → polite close, no further contact.
   - **says they're interested** (after the pitch) → `stage = hot_lead`,
     `human_takeover = true`, an `events` row fires a realtime alert + browser
     notification in the dashboard. The AI stops responding — take over in the chat.
   - **says not interested** → polite close, `stage = closed`, no further pushes.
   - opt-out keywords ("stop", "unsubscribe", etc.) → acknowledged, `opted_out = true`,
     never contacted again.
4. Taking over a chat in the dashboard (typing a reply, or the "Take over" button)
   sets `human_takeover = true` — the AI will not reply to that lead again until you
   hand it back.

## Repository layout

```
app/                  Vite + React dashboard (inbox, leads, settings)
n8n-workflows/         Source for the two n8n workflows (also live in n8n as drafts)
```
