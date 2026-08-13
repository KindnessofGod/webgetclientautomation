# Handoff — WhatsApp Outreach Automation ("iKAN GROWTH ENTERPRISE" / Sophie)

Written 2026-08-11 because the current session's weekly token budget is nearly
exhausted. Picking this up in a new tool/session (opencode or otherwise)?
Read this whole file before touching anything — most of the state that
matters lives in **n8n and Supabase, not in this git repo**.

## 1. What this system is

Cold-outreach automation: WhatsApp Cloud API (Meta) + Supabase (DB) + n8n
(workflow engine, hosted at `n8n.remoten8n.duckdns.org`) + a React dashboard
(this repo, `app/`, deployed to Vercel). An AI persona ("Sophie", for "Ikan
Group" / iKAN GROWTH ENTERPRISE) sends a first-touch template message to
leads, then drafts human-like replies to inbound WhatsApp messages using
conversation history + intent classification, escalating "hot" leads
(interested) to human takeover.

Target scale: **up to 2000 messages / 24h** (user-confirmed real Meta tier).

## 2. Source of truth is NOT this repo

**Important**: `n8n-workflows/inbound-reply-handler.ts` and
`outbound-first-touch.ts` in this repo are **stale exports from before this
session's fixes**. All real work this session was done by editing the live
n8n workflows directly via n8n's MCP tools (`mcp__n8n__update_workflow`,
`publish_workflow`, etc.), NOT by editing these files and redeploying. The
live n8n workflows are current; these `.ts` files are not. If you want the
repo to reflect reality, you'd need to re-export/re-generate them from the
live workflows — nobody has done that yet this session.

n8n access: use the `mcp__n8n__*` MCP tools (search_workflows,
get_workflow_details, get_execution, execute_workflow, test_workflow,
update_workflow, publish_workflow, list_credentials, etc.). Direct HTTP
access to the n8n public webhook URL is **blocked** from sandboxed
environments (confirmed: `curl` → connection rejected). All live
diagnostics must go through n8n's own MCP tools, which run inside n8n's own
environment.

Supabase project: `uqnqcywnileazxirzyxv` ("whatsapp-outreach-campaign",
us-east-1). Use `mcp__Supabase__*` tools.

## 3. The 5 n8n workflows

| Workflow | ID | Trigger type | Executable via `execute_workflow`? |
|---|---|---|---|
| WA Outbound — First-Touch Sender | `z3KarZgzcxfB1azz` | Schedule | Yes |
| WA Inbound — Reply Handler | `If8jiQRRvIm6Zyks` | `n8n-nodes-base.whatsAppTrigger` | **No** — only Schedule/Webhook/Form/Chat/Manual trigger types are supported by the tool. Confirmed via direct tool error. Real testing requires an actual inbound WhatsApp message, or `test_workflow` (pins ALL nodes incl. Supabase/OpenAI/WhatsApp send — fully synthetic, not a real integration test). |
| WA Follow-Up Sequencer | `3fm8HioifztPSsCJ` | Schedule | Yes |
| WA Follow-Up Approval Handler | `yM9yI1b6exkSw1oM` | generic Webhook | Yes |
| WA Manual Send — Dashboard | `fVE6LK79bXmEmAjH` | Webhook (called from dashboard) | Yes |

## 4. What was fixed and verified this session (all live, real executions — not simulated)

1. **Inbound reply pipeline race condition**: `Build AI Context` could fire
   before the parallel `Get Recent Message History` branch finished. Fixed
   by adding a `Sync Before AI Context` Merge node
   (`chooseBranch`/`waitForAll`) between the two parallel branches and
   `Build AI Context`. Node id `sync-history-merge-001`.
2. **`$json` pollution bug**: `Send Offer PDF (If Configured)` ran
   unconditionally (misleading name — no real gate existed), failed because
   no offer template is configured, and its `onError: continueRegularOutput`
   error output replaced `$json` entirely for that item — silently wiping
   the AI's drafted reply before `Send AI Reply Text` used it (implicit
   `$json.output.reply`), so Meta rejected the send (missing body). Fixed by
   (a) adding a real `Offer PDF Configured?` IF gate (node id
   `offer-pdf-configured-001`) so the PDF step is skipped when unconfigured,
   and (b) changing `Send AI Reply Text`'s `textBody` to the explicit
   reference `={{ $("Draft Human-Like Reply").item.json.output.reply }}`.
3. **Repeated greeting bug** (user-reported): system prompt for
   `Draft Human-Like Reply` (`@n8n/n8n-nodes-langchain.agent`) said "greet
   if it feels natural" with no frequency constraint → AI said "good
   afternoon" on every message. Fixed by rewriting the greeting instruction
   to check conversation history for any prior casual "You:" line and skip
   the greeting if one exists. First-touch template message doesn't count
   (it's fixed/formal, sent separately).
4. **AI context window** (user-requested): `Get Recent Message History`
   `limit` raised from 10 → 50.
5. **Follow-up approval bypass (critical)**: `Send Follow-Up Template` was
   wired directly off `Get Lead`, running in parallel with the `Is
   Approved?` gate — it fired on EVERY decision (approve or reject). Fixed
   by rewiring it behind the IF node's true/approved branch only. **Verified
   both directions live**: execution 103 (reject) → confirmed no send;
   execution 108 (approve) → confirmed real send, Meta accepted it
   (`message_status: "accepted"`, real wamid).
6. **No idempotency protection against duplicate Meta webhooks**: Meta
   guarantees at-least-once delivery; nothing prevented a redelivered
   webhook from creating duplicate messages/AI replies. Fixed via migration
   `add_dedup_and_scale_indexes` (unique partial index on
   `messages.wa_message_id`, plus supporting indexes — see section 6).
7. **Outbound sender couldn't scale to 2000/day**: `Get Queued Leads` used
   to pull the ENTIRE remaining daily cap into one execution with 25-180s
   inter-message delays — at 2000/day that's 14-57+ hours per run, far
   exceeding the 10-min schedule interval, with no protection against
   overlapping runs re-sending to the same "queued" leads. Fixed via:
   - Bounded batch size per run: new `send_batch_per_run` setting (default
     50), `Get Queued Leads.limit` now
     `={{ $("Compute Pacing").item.json.runBatchSize }}`.
   - Tightened jitter 25-180s → 3-8s (justified: Meta's anti-abuse is driven
     by quality rating / block-report rate, not per-message send cadence —
     jitter this wide only throttled throughput, it didn't add real
     protection).
   - Self-expiring 15-min distributed lock via `campaign_settings.sender_lock_until`:
     `Acquire Send Lock` node sets `now + 15min` at batch start,
     `Release Send Lock` sets `now` (immediately expired) at batch end. If a
     run crashes without releasing, the lock self-expires after 15 min.
   - **Bug caught during this fix**: both new Supabase nodes got
     auto-assigned the WRONG credential ("remote" project) by n8n's
     auto-assign heuristic. Caught via the `autoAssignedCredentials` field
     in `update_workflow`'s response before publishing; corrected to
     credential id `i3Knwzey51F553iX` ("WhatsApp Campaign Supabase").
   - Verified live: execution 105 (batch fix) →
     `runBatchSize:50, jitterMin:3, jitterMax:8, canSend:true`. Execution
     107 (lock added) → `lockActive:false` read correctly, lock nodes
     correctly skip when 0 items upstream.
   - **New theoretical capacity**: ~4500/day max, ~6.7h to clear 2000
     leads within the 06:00-21:00 Africa/Lagos send window (was
     "impossible" — 14-57h — before this fix).

All changes are **published and live** in n8n (see version IDs in section
7 if you need to check `get_workflow_history`).

## 5. Newly-discovered finding — NOT YET ACTED ON

`follow_up_1` template (`not_replied_to1st_pitch_day2`) is flagged
`active: false` in `message_templates`, but a live test send (execution 108)
proved **Meta actually accepts it** (real successful delivery, accepted
status). This means the DB's approval-tracking is stale/wrong, and the WA
Follow-Up Sequencer (which filters `active=true`) is currently skipping a
template that actually works. **Action needed**: check WhatsApp Manager for
real approval status of all 3 follow-up templates
(`not_replied_to1st_pitch_day2`, `follow_up_day_5_no_reply`,
`day_10_followup_no_reply`) and flip `active: true` in `message_templates`
for any confirmed-approved ones. All three currently show `active: false`.

## 6. Supabase state (project `uqnqcywnileazxirzyxv`)

Tables: `niches`, `message_templates`, `leads`, `conversations`, `messages`,
`events`, `campaign_settings`, `pending_follow_ups`. Notable constraints:
`leads.phone_e164` unique, `conversations.lead_id` unique.

Migration applied this session — `add_dedup_and_scale_indexes`:
```sql
create unique index if not exists messages_wa_message_id_unique
  on public.messages (wa_message_id) where wa_message_id is not null;
create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists leads_status_opted_out_idx
  on public.leads (status, opted_out);
create index if not exists conversations_human_takeover_idx
  on public.conversations (human_takeover);
create index if not exists messages_direction_type_created_at_idx
  on public.messages (direction, message_type, created_at);
```

`campaign_settings` current state:
```
daily_send_cap: 100            <- NOT yet raised for real campaign (see section 8)
whatsapp_tier_limit: 1000      <- STALE, user confirmed real tier is 2000, not updated
send_window: {"start":"06:00","end":"21:00","timezone":"Africa/Lagos"}
send_batch_per_run: 50
send_jitter_seconds_min: 3
send_jitter_seconds_max: 8
sender_lock_until: (self-managed by Acquire/Release Send Lock nodes)
```

`message_templates`: only `first_touch` (`web_design_v1`) is `active: true`.
`follow_up_1/2/3` all exist but `active: false` (see section 5 — at least
`follow_up_1` is probably wrong). **No `pitch` or `offer` stage templates
exist at all** — see open item F-4 below.

Test lead (used for all live testing this session, do not delete without
checking with user): `id: 2afd833c-9652-4b5b-bce3-2a2af14dd72c`,
`phone_e164: +2347013390746`, conversation `id:
1c7d4f3e-597b-4a37-b785-86f9fce29592`, `stage: 'pitched'`. All synthetic
test rows created during testing (`pending_follow_ups`, `events`) were
cleaned up after each test; the test lead's `follow_up_count`/
`last_followup_at` were reset to `0`/`null`.

**Only 1 lead exists in the `leads` table right now — the test lead.** The
user's real lead list (500-2000 leads) has NOT been imported yet.

## 7. Audit report (published artifact)

A full pre-launch audit with 6 ranked findings (F-1 through F-6) and a
categorized test plan (A-F test IDs) was written and published:
`https://claude.ai/code/artifact/8ffcac5a-77d2-4947-b79b-708758775add`
(source file:
`/tmp/claude-0/-home-user-webgetclientautomation/7f61357a-45e6-5546-b942-e195f546370e/scratchpad/audit-report.html`
— this scratchpad path is session-specific and **will not exist** in a new
session; treat the published artifact URL as the durable copy, or
regenerate from this handoff doc if needed).

**Status of findings**: F-1 (approval bypass) — fixed & verified both
directions. F-2 (throughput) — fixed & verified. F-3 (idempotency) — fixed.
F-4 (no pitch/offer templates), F-5 (UTC vs Africa/Lagos daily-cap boundary
drift), F-6 (no conversion-funnel dashboard) — all still **open**, see
section 8. The published artifact has NOT been redeployed to reflect F-1/F-2
completion or the section-5 finding — should be redeployed if the user wants
it kept current (same `file_path` via the `Artifact` tool updates it in
place).

## 8. Open / pending work

**Telegram bot token — RESOLVED (2026-08-12).** User rotated the token with
@BotFather and created a proper `telegramApi` credential in the n8n UI
(`iKANWEBLEADbot`, id `UjOTEdNBpZUKW3Z2`). All 3 places that had the token
hardcoded in plaintext (`Notify Kindness (Telegram)` in the inbound
workflow, `Send Error Telegram Alert` in the outbound workflow, `Send
Telegram Alert` in the `Ops Alerts — Telegram` workflow) were swapped from
raw HTTP Request nodes to native `n8n-nodes-base.telegram` nodes using that
credential. No plaintext token remains in any workflow JSON. All three
published and live.

**Duplicate-AI-reply bug — FIXED (2026-08-12).** A lead ("Abdul Phone
Accessories") got the same pitch+PDF sequence sent twice, because two
inbound messages arriving >25s apart (past the debounce window) each
independently passed the idempotency "claim" step — the claim update used a
correct compare-and-swap WHERE clause, but nothing downstream checked
whether the update actually matched/returned a row before proceeding to
send. Root-caused via `get_execution` + full node/connection trace on
`If8jiQRRvIm6Zyks`. Fixed by adding a `Claim Succeeded?` IF gate right after
`Claim Inbound Message (Idempotency Lock)` that only proceeds to
`Split Reply Into Bubbles` if `Boolean($json.id)` — i.e. the claim actually
won a row. Debounce window (`Debounce Burst Window` node) was briefly
changed 25s→10s then reverted back to 25s per user request; this number is
now purely a UX/bundling knob, not a safety net — the claim gate is what
actually prevents duplicates regardless of its value.

**Branches consolidated.** `claude/whatsapp-automation-campaign-vuq6b0` was
fast-forwarded to match `claude/handoff-doc-o3ehx9` (the branch another
session did significant work on — dashboard Replies/Unqualified tabs,
drag-and-drop file sending, pitch/offer templates, real lead import) and
pushed. Both branches now point at the same history. The dead orphaned
`WA Manual Send — Dashboard v2` workflow (`bQepIWzDMIrApZfR`) was archived.

**Campaign is live, not just tested.** As of 2026-08-12: 250 real leads
imported, `daily_send_cap` and `whatsapp_tier_limit` both raised to **2000**
(skipped the staged-rollout recommendation — worth revisiting if delivery
quality dips), 200 first-touch sent, 46 replied. `follow_up_1`
(`not_replied_to1st_pitch_day2`) was flipped to `active: true` — verified
Meta-accepted send exists for it (see section 5).

**F-4 and F-5 — RESOLVED.** F-4 (no pitch/offer templates): both now exist
and are `active: true` (added by the other session). F-5 (daily-cap reset
using UTC instead of Africa/Lagos midnight): fixed 2026-08-12 — `Count Sent
Today` in `z3KarZgzcxfB1azz` now filters `created_at >= {{ $now.setZone
('Africa/Lagos').startOf('day').toUTC().toISO() }}` instead of
`$today.toISO()` (which was UTC midnight from the n8n instance default
timezone). Verified live via execution 2335: ran clean, `sentToday: 1`
matched the correct Lagos-day window, `withinWindow: false` correctly
reflected it being outside the 06:00-21:00 Lagos send window at test time.

**Health check (2026-08-12, end of session)**: no error/crashed executions
on any of the 5 workflows since 19:00 UTC — the duplicate-reply fix, the
debounce revert, the 3 Telegram credential swaps, and the F-5 timezone fix
are all confirmed stable in production.

Remaining open items, genuinely need the user (not blocked on tooling):

1. **F-6**: No conversion-funnel / stats view in the dashboard. Open,
   nobody's asked for it built yet.
2. **Vercel env var unverified**: could not confirm
   `VITE_N8N_MANUAL_SEND_WEBHOOK_URL` on the `ikan-outreach-inbox` Vercel
   project actually points at the current `/wa-manual-send-v2` webhook path
   — the platform's safety classifier blocked a curl call using a
   user-pasted Vercel token before this could be checked, and that block
   should be respected rather than routed around. Check manually in the
   Vercel dashboard, or grant a Bash permission rule if you want it
   re-attempted via API.
3. **`follow_up_2`/`follow_up_3` active flags**: `follow_up_3` was flipped
   active by the other session without the same kind of verification
   `follow_up_1` got. Worth confirming real Meta approval status for both in
   WhatsApp Manager before relying on them.
4. **Rotate the Vercel token** pasted into chat earlier this session, same
   reasoning as the Telegram token (already rotated) — it's sat in
   conversation history since being shared, independent of whether it's
   still valid.

## 9. Working style established this session (carry forward)

- **Verify claims with real execution data, not assumptions.** Every fix
  above was confirmed via `mcp__n8n__get_execution` with `includeData:true`
  on a real execution ID before being reported as working.
- Check `autoAssignedCredentials` in every `update_workflow` response after
  adding a credentialed node (e.g. Supabase) — n8n's auto-assign can pick
  the wrong project's credential silently.
- Use `updateNodeParameters` with `replace: true` for nested/collection n8n
  node parameters — `setNodeParameter` with `/parameters/...`-style paths
  can silently create dead duplicate structures. Simple top-level paths
  (`/limit`, `/textBody`) are fine with `setNodeParameter`.
- Clean up synthetic test data (`pending_follow_ups`, `events` rows) after
  each live test, and reset any lead fields you mutated for the test
  (`follow_up_count`, `last_followup_at`, etc.) so future tests aren't
  polluted.
- Prefer explicit `$("NodeName").item.json.field` references over implicit
  `$json` anywhere an upstream node has `onError: continueRegularOutput` —
  the error object silently replaces `$json` for that item.

## 10. Second bug-hunt pass (2026-08-13) — found via real conversation review

The user reviewed live conversations in the dashboard and reported several
issues by pasting screenshots of real chats. Each was root-caused against
real n8n execution data before fixing, not assumed. All fixed and published.

1. **Total silence on a matched "auto-reply" message — FIXED.** "The
   waterside venue lekki" sent "How may we help you?", which matched the
   `Looks Like Auto-Reply?` regex (meant to detect WhatsApp Business bot
   greetings). The workflow **never replied and never would have** —
   confirmed via the exact execution trace (id 1956): the IF node fired
   correctly, but the downstream node wired from BOTH its outputs never
   ran, despite the connection existing in the workflow JSON. A sibling
   execution for the same lead's prior message (the false branch) worked
   fine with identical wiring — this is an n8n engine quirk with two
   branches converging on one node, not a logic bug in the regex. Fixed by
   removing the IF node from the send path entirely and wiring
   `Log Inbound Message` directly to `Mark Lead Replied` — one
   unconditional path, no branch-merge ambiguity possible. This lead was
   still sitting unanswered when found; needs a manual reply since the
   pipeline won't retry on its own.
2. **Non-text inbound messages silently became blank — FIXED.** Marisco
   Hair and Nail Studio sent two voice notes; Aimas Garden forwarded a PDF.
   `Normalize Inbound Message` only ever read `.text.body`, and
   `Log Inbound Message` hardcoded `message_type: "text"` — so anything
   that wasn't a plain text message logged as an empty string, the
   dashboard showed a blank bubble, and the AI drafted replies based on
   nothing (explains why some AI replies were generic guesses). Both
   confirmed via raw WhatsApp webhook payloads pulled from n8n execution
   history (`type: "audio", voice: true` / `type: "document"`). Fixed:
   `Normalize Inbound Message` now detects the real WhatsApp message type
   (text/interactive/image/document/audio/video/sticker/location/contacts/
   reaction) and produces a readable placeholder (`[Voice message]`,
   `[Document: filename]`, etc.) plus the correct `message_type` for the DB
   constraint. Interactive button/list replies are treated as real text
   since their title IS the meaningful content. **Does not yet
   download/display the actual media** — see section 11, item 1.
3. **Delivery-failure reason silently discarded — FIXED.** Happiness Unisex
   Beauty Salon's first-touch showed `status: 'failed'` in the UI with no
   explanation (`messages.error` was `null`). Root cause: the send itself
   succeeded at the API level (Meta returned `message_status: "accepted"`,
   confirmed via the batch execution trace) — it failed asynchronously
   later, and `Extract Status Updates`'s code only ever captured
   `{id, status}` from Meta's status webhook, discarding the `errors` array
   that explains why. The original reason for this specific incident is
   unrecoverable — it was thrown away before ever reaching the database.
   Fixed going forward: `Extract Status Updates` now keeps `errors`,
   `Update Message Status` writes it into `messages.error`, and a new
   `Delivery Failed?` gate fires a Telegram alert (business name, phone,
   real failure reason) the instant Meta reports one, instead of it only
   being discoverable later by noticing an unexplained badge in the UI.
4. **Proved WhatsApp media is re-fetchable after the fact.** Built a
   temporary diagnostic chain (HTTP Request with `predefinedCredentialType:
   whatsAppApi` → `GET https://graph.facebook.com/v22.0/{media-id}` → GET
   the returned temporary URL → `extractFromFile` `binaryToPropery` to
   base64) to pull yesterday's PDF and two voice notes down to disk and
   send them to the user directly. Confirms the original webhook's
   `lookaside.fbsbx.com` URL (expires ~5 min after issue) is NOT the only
   way to get media — Meta will re-issue a fresh temporary URL from the
   permanent media `id` for some retention window after the message was
   received (worked fine ~31 hours later for this test). This is the
   proven building block for item 1 in section 11. Diagnostic nodes were
   added to `Ops Alerts — Telegram` as an unpublished draft, tested, then
   removed — production/active version was never affected.

## 11. Feature roadmap requested by user (2026-08-13) — NOT YET BUILT

User asked for these explicitly, voice-dictated, and asked that everything
built from here forward be documented as it happens (this section is that
practice starting now — update it, don't let it go stale):

1. **Sophie can read PDFs sent to her.** Needs: (a) the media-download
   pipeline proven in section 10 item 4, made permanent in the inbound
   workflow — auto-fetch on receipt rather than on-demand; (b) PDF text
   extraction — `n8n-nodes-base.extractFromFile` operation `pdf` can pull
   text directly, no LLM vision call needed for text-based PDFs (an
   image-only/scanned PDF would need OCR instead, worth checking template
   PDFs like the ones seen so far aren't scans); (c) feed the extracted
   text into `Build AI Context` so `Draft Human-Like Reply` can actually
   respond to what's in the document, not just acknowledge receipt.
2. **Sophie can hear and understand voice notes.** Needs: (a) same
   media-download pipeline as above for `audio`-type messages; (b) speech-
   to-text — user mentioned Whisper explicitly; OpenAI's Whisper API
   (`audio.transcriptions`) is the direct fit since OpenAI is already the
   credentialed provider in this system (credential `aEiYYdLhZaR8efIk`) —
   would need an HTTP Request node (n8n has no dedicated Whisper node,
   would use `predefinedCredentialType: openAiApi` against
   `https://api.openai.com/v1/audio/transcriptions`, multipart form body
   with the downloaded `.ogg` file); (c) feed the transcript into
   `Build AI Context` same as PDF text.
3. **Dashboard shows every message type, not just text.** Needs: (a) the
   download pipeline uploading fetched media to Supabase Storage (the
   `assets` bucket already exists and already has an upload policy from
   the manual-send file feature) so it has a permanent, publicly-servable
   URL — `messages.media_url` needs to actually get populated, which it
   currently never does for inbound media; (b) `MessageBubble.tsx` in the
   dashboard needs new rendering branches for `image` (`<img>`), `document`
   (PDF preview or download link), `audio` (`<audio controls>` — this also
   covers "let me listen to voice notes" as an ongoing UI feature, not a
   one-off pull like section 10 item 4), `video` (`<video controls>`); (c)
   emoji: WhatsApp text messages already carry emoji as literal UTF-8
   characters in `.text.body` — these should already render correctly
   wherever plain message text is displayed already, worth a quick check
   whether that's actually true before assuming it needs separate work.
4. **Voice call attempts should be logged/noted.** WhatsApp Business
   Calling API sends call-event webhooks (`call_connect`, `call_terminate`,
   etc.) as a distinct payload shape, not under `messages` or `statuses` —
   `Normalize Inbound Message` and `Has Real Message?` would need a new
   branch to recognize and log these (e.g. as an `events` row and/or a
   `message_type: 'other'` message row with body `[Voice call attempted]`)
   instead of silently falling through unhandled as they would today.
   Needs checking whether the WhatsApp Business phone number this system
   uses actually has Calling API enabled at all before building this —
   calling isn't on by default.

None of section 11 has been started. Item 1 (media download → Supabase
Storage → dashboard rendering) is the common foundation under items 1-3 and
is the natural place to start if asked to proceed.
