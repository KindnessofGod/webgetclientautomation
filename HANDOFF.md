# Handoff — WhatsApp Outreach Automation ("iKAN GROWTH ENTERPRISE" / Sophie)

Written 2026-08-11 because the current session's weekly token budget is nearly
exhausted. Picking this up in a new tool/session (opencode or otherwise)?
Read this whole file before touching anything — most of the state that
matters lives in **n8n and Supabase, not in this git repo**.

## 0. Lessons learned — read this before starting a similar project

This section exists specifically so the *next* n8n + Supabase + WhatsApp (or
similar) automation project doesn't re-discover these the hard way. These
are general, reusable pitfalls, not specific to this campaign's business
logic — everything else in this file is chronological project history;
this section is the distilled "don't do this again" checklist.

1. **Two IF/Switch branches wired to the same downstream node can silently
   fail to fire, with no error.** This cost real customer replies (see
   section 10, item 1) — the IF node correctly evaluated, but the shared
   downstream node sometimes just didn't run, and the execution reported
   "success" anyway. Don't converge two branches onto one node unless you
   go through an explicit Merge node. If both branches are meant to do the
   same thing, that's a sign the IF node shouldn't exist at all — remove it
   and wire one unconditional path instead.
2. **n8n silently auto-assigns credentials when creating/updating nodes
   programmatically, and it can pick the wrong project.** This happened
   *twice* in this project on different workflows (see section 9's fix
   list and this session's watchdog build) — a brand-new Supabase node
   defaulted to an unrelated "remote" credential instead of the actually-
   correct one, with no warning surfaced anywhere except the
   `autoAssignedCredentials` field in the API response. Check that field
   on every node-creating call, every time, and explicitly set the
   credential if it's not exactly right — don't trust the default.
3. **`$json` is not stable after any node with error-handling or
   transformation behavior runs.** A node with `onError:
   'continueRegularOutput'` replaces `$json` entirely with the error object
   on failure, silently wiping whatever was there before (cost a real send:
   see section 6). HTTP/extract/transform nodes don't reliably pass
   unrelated fields through either. Reference upstream data explicitly by
   node name (`$("NodeName").item.json.field`) anywhere downstream of such
   a node, rather than trusting implicit `$json` pass-through.
4. **A workflow-level error-workflow (Telegram/Slack alert on exception)
   only catches *thrown* errors.** A node that legitimately returns zero
   output items because of a logic bug is NOT an exception — the execution
   reports "success" and nothing pages anyone. This class of bug is
   invisible to error-workflow alerting by design. For anything customer-
   facing or revenue-critical, also build an independent watchdog that
   queries actual database state on a schedule (e.g. "any conversation
   whose last message is an unanswered inbound reply older than N
   minutes?") rather than trusting the workflow's own opinion of whether it
   succeeded.
5. **WhatsApp Cloud API: you cannot send free-text as the first message to
   a number that has never messaged you.** Business-initiated contact must
   use a pre-approved message template (Meta's 24-hour customer-service-
   window rule). This matters for any "reach out to a new/referred number"
   flow — plan for template approval lead time, it isn't instant.
6. **Prove new integrations against a real execution before publishing,
   not just against documentation.** This project's working pattern: add
   temporary "TEMP" nodes to a disposable sandbox workflow (this project
   used the "Ops Alerts — Telegram" workflow), run them for real against
   live credentials, inspect the actual `get_execution` output (not just
   "did it error"), then remove the temp nodes. Caught real issues
   (wrong field names, empty extraction results) that documentation alone
   wouldn't have surfaced.
7. **Non-text webhook payloads each have a different JSON shape.** WhatsApp
   messages carry `type: "image"|"document"|"audio"|"video"|"interactive"|
   "location"|"contacts"|"reaction"|"sticker"`, each with different nested
   fields — assuming everything has `.text.body` silently turns every
   non-text message into an empty string downstream (see section 10, item
   2). Normalize explicitly per type immediately after the trigger node.
8. **A debounce window alone does not prevent duplicate sends under real
   race conditions.** Bursty user input (someone typing several WhatsApp
   bubbles in a row) can spawn multiple concurrent executions even with a
   debounce window bundling them, if messages are spaced further apart than
   the window or arrive at its edge. Needed both: a debounce window
   (reduces how often bursts spawn parallel work) AND an atomic
   claim/idempotency lock immediately before the actual send (re-check
   "is this still the freshest unanswered message" via a conditional DB
   update, proceed only if it matched a row). See section 9 for the full
   sequence of fixes this took to get right.
9. **A "stop the AI" / human-takeover signal needs to be re-checked
   immediately before every send, not just once at the start.** Long
   in-flight delays (simulated typing delay, debounce windows) create a
   real window where a human clicking "take over this chat" doesn't
   actually stop an AI reply that's already most of the way through
   sending. Re-fetch and re-check the takeover flag right before each send
   action, not only when the execution started.

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

## 12. Feature roadmap — BUILT (2026-08-13, same day as section 11)

All of section 11 was implemented and published live the same day it was
requested, except voice-call logging (confirmed not applicable — see item 4).

**Migration** `add_video_message_type`: added `'video'` to the
`messages.message_type` check constraint (was previously
text/template/document/image/audio/other only).

**n8n (`WA Inbound — Reply Handler`, `If8jiQRRvIm6Zyks`) — new media
pipeline**, inserted between `Normalize Inbound Message` and
`Has Real Message?`:

1. `Normalize Inbound Message` gained 3 new fields: `waRawType` (the real
   WhatsApp message type string), `waMediaId` (the media object's `id`,
   whichever of image/document/audio/video/sticker is present), and
   `waMediaFilename` (document filename if any). `inboundMessageType` now
   also maps `video` → `"video"` instead of collapsing into `"other"`.
2. `Has Media?` (IF, checks `waMediaId` truthy) branches into the fetch
   chain or straight to `Set No Media` (plain text/interactive/etc., no
   change in behavior).
3. Fetch chain: `Get Media Info` (Graph API `GET /v22.0/{media-id}` →
   `{url, mime_type, ...}`, `whatsAppApi` credential) → `Compute Storage
   Path` (Code node, builds `inbound-media/{phone}/{waMessageId}.{ext}`
   from the mime type) → `Download Media Binary` (HTTP GET the temp url,
   `responseFormat: file`). From there it fans out to two independent
   branches (same binary, two consumers — this does NOT reproduce the
   two-outputs-of-one-IF-node convergence bug from section 10; this is the
   already-proven "N different upstream nodes → same target" pattern used
   elsewhere in this workflow, e.g. `Compute Human Typing Delay`):
   - **Branch A** — `Upload To Storage` (HTTP POST to Supabase Storage
     REST API, `assets` bucket, `supabaseApi` credential — service-role
     key bypasses the bucket's RLS policy which is otherwise scoped to
     `manual-sends/` only) → `Set Media URL` (builds the public URL).
   - **Branch B** — type-specific enrichment: `Is Document?` →
     `Extract PDF Text` (`extractFromFile`, op `pdf`, output field
     confirmed as `.text` via live test) → `Set Enriched Body (Doc)`
     (`"[Document: name] <extracted text, first 6000 chars>"`, falls back
     to "(no extractable text — likely a scanned/image PDF)" if empty).
     `Is Audio?` → `Transcribe Voice Note` (`@n8n/n8n-nodes-langchain.openAi`,
     resource `audio` op `transcribe` = Whisper, `openAiApi` credential,
     output field confirmed as `.text` via live test) → `Set Enriched Body
     (Audio)` (`"[Voice message] <transcript>"`). Neither doc nor audio →
     `Set Enriched Body (Other Media)` (image/video/sticker: keeps
     Normalize's placeholder text, e.g. `[Image]`).
   - `Sync Media Result` (Merge, `combine`/`combineByPosition`) joins
     branch A + branch B back into one item before continuing to
     `Has Real Message?`. Every terminal node in both branches explicitly
     rebuilds `messages`/`phoneE164`/`waMessageId` via
     `$("Normalize Inbound Message").item.json.X` (not passthrough) —
     HTTP/extract/transcribe nodes don't reliably preserve unrelated input
     fields, so relying on passthrough would have silently broken
     `Has Real Message?`'s `$json.messages` check for every media message.
4. `Log Inbound Message` and `Split Latest Message Burst` (the debounce
   fallback) now read `inboundBody`/`inboundMessageType`/`waMessageId`/
   `mediaUrl` from `$("Has Real Message?")` — the one node every branch
   converges through — instead of `$("Normalize Inbound Message")`, which
   never saw the enriched values. `Log Inbound Message` also gained a new
   `media_url` field mapping.
5. Published as `activeVersionId c254b055-7d47-4d48-bc21-37b2d890f688`.

**Live-tested before publish** (not simulated): reused real, still-valid
Meta media IDs recovered from this session's earlier diagnostic run
(`inbound-media` docs/voice notes fetched ~2h earlier) in a temporary
scratch chain inside `Ops Alerts — Telegram` (same safe unpublished-draft
pattern as section 10 item 4; cleaned up after). Confirmed live: Supabase
Storage upload succeeds with the `supabaseApi` credential (service role
bypasses the `manual-sends/`-only RLS policy — no policy change needed),
Whisper transcription succeeds and returns real text, PDF extraction
mechanism works (confirmed `.text` field) though the one real PDF tested
happened to have no extractable text layer (image/vector export) — the
"likely a scanned/image PDF" fallback path is what will actually show for
that document going forward, which is correct behavior, not a bug. Full
workflow structural validation (`update_workflow`'s built-in validation)
came back clean for every new node/connection.

**Dashboard** (`app/src/components/MessageBubble.tsx`): now renders
`image` as `<img>`, `video` as `<video controls>`, `audio` as
`<audio controls>` with the transcript shown as a caption underneath, and
`document` as a short filename link with the extracted text shown as a
clamped 4-line preview below it (previously the full extracted text would
have rendered as the link's own label — split out via a
`splitDocumentBody()` helper). Emoji needed no work — WhatsApp text
messages already carry emoji as literal UTF-8 in `.text.body`, which
already renders correctly wherever message text is displayed.
`database.types.ts` updated with `'video'` in the `message_type` union.

**Voice call logging — checked, not applicable.** Queried Meta's Graph API
directly (`GET /v22.0/{phone-number-id}/settings`) and confirmed
`calling.status: "NOT_SET"` — the WhatsApp Business Calling API is not
enabled on this number, so there is no call-event webhook to receive or
log. Nothing was built. If Calling is enabled later, `Normalize Inbound
Message`/`Has Real Message?` would need a new branch to recognize the
distinct call-event payload shape (not nested under `messages` or
`statuses`) and log it as an `events` row.

## 13. Bug fix — inbound trigger timeout (2026-08-13, post-publish)

Telegram ops alert fired: `WhatsApp Inbound Event` node, "operation timed
out for an unknown reason" (execution 2416). Investigated via
`get_execution` with full data — **not** a bug in the new media pipeline.
The stack trace is entirely inside n8n's own internals
(`CredentialsHelper.getCredentialsEntity` → `SqliteReadonlyConnectionPool`
→ `tarn` connection-pool timeout): n8n's self-hosted instance uses SQLite
for its own internal store (credentials/executions/workflow state,
separate from the Supabase app database), and under load that pool can
briefly lock up before the trigger node even reads the incoming webhook
body — so the execution errors out at 71ms with an empty payload, before
any lead/message logic runs. Checked recent history:
`search_executions` showed this same failure mode once on 2026-08-11 and
once on 2026-08-13; a separate, already-resolved cluster on 2026-08-12
(executions 1241–1248) was a stale-PostgREST-schema-cache issue on the
Supabase side, not this.

Since the WhatsApp trigger node had no retry settings at all, any one of
these transient internal-DB blips outright drops that inbound webhook
delivery (Meta may or may not retry it). Fix: added `retryOnFail: true,
maxTries: 3, waitBetweenTries: 2000` to the `WhatsApp Inbound Event` node
via `update_workflow`'s `setNodeSettings` operation, then published
(`activeVersionId 24c540e7-a327-442a-b7d0-b6c067d2ef2c`). This gives a
transient SQLite pool contention up to ~4 seconds and 2 extra attempts to
clear before the execution actually fails and alerts.

Not fixed (out of scope for this session, needs host-level access this
session doesn't have): the underlying cause is SQLite as n8n's internal
DB under concurrent load — several inbound webhooks landing close
together, some sitting in a 10s `Debounce Burst Window` Wait node, appear
to be enough to contend the pool. n8n's own docs recommend Postgres (or
queue mode) as the internal DB backend for higher-throughput self-hosted
deployments; if this alert recurs frequently even with the retry in
place, that's the next lever, not another workflow-level change.

## 14. Silent-drop incident review (2026-08-13/14) — root cause, watchdog,
wrong-number tagging, redirect flow — BUILT

User reported real conversations where Sophie either never replied at all,
or replied with a generic pitch to someone who'd already said this was the
wrong contact. Investigated via direct SQL against `messages`/`conversations`
rather than trusting the reported examples as exhaustive — found **9** leads
silently dropped, not the 3 the user had examples for. Root cause: the
already-known n8n bug (section 0, pitfall 1) where two IF/Switch branches
wired directly to the same downstream node can silently fail — present in
an older part of the routing graph. All 9 backfilled by hand; the
underlying branch-convergence pattern was already being avoided in new work
via explicit Merge nodes / single-Switch-output wiring (see the bot-
detection gate built earlier the same day, and everything in this section).

**Watchdog — `Watchdog — Stale Unanswered Replies` (`E9CLPYYj6AKhvMug`,
new workflow).** Independent safety net, not dependent on the main
workflow's own logic being correct: Schedule Trigger (5 min) → Supabase
`getAll` on a new view `stale_unanswered_conversations` (latest message is
inbound, `ai_enabled`, not `human_takeover`, `minutes_since >= 20`) →
Telegram alert with business name/phone/stage/their actual message.
**Duplicate-alert bug found and fixed same day**: the watchdog had no
dedup, so it re-alerted the same unresolved message every 5-minute cycle
indefinitely (one lead, "Ki Bar and Kitchen", alerted ~8 times) — user
caught this from the noise. Fixed with `messages.stale_alerted_at
timestamptz null` (migration `add_stale_alerted_at_dedup`) + a `stale_alerted_at
is null` filter on the view query + a new terminal node `Mark Stale Alert
Sent` that sets it after alerting. **Lesson repeated from section 0 pitfall
9, learned the hard way a second time in the same session**: testing this
fix via `execute_workflow` in manual (non-pinned) mode fired 9 real
Telegram alerts, because manual/non-pinned execution has real external side
effects — same mistake as before, on a different node this time. Do not run
`execute_workflow` against any node with a real external side effect
(Telegram send, WhatsApp send, DB write) without pinning test data first or
asking the user, full stop — the cost of getting this wrong is a real
message going out.

**Wrong-number tagging.** `Route By Intent` previously routed `confirm_no`
(flat "wrong number/business" replies with no alternate contact offered)
into the same catch-all fallback as generic `other` messages — so those
conversations replied correctly but never got tagged, staying stuck at
whatever stage they were in before, forever. Gave `confirm_no` its own
Switch rule → new node `Update Stage: Wrong Number` (sets
`conversations.stage = 'wrong_number'`) → continues into the same shared
reply-send pipeline as every other branch (`Compute Human Typing Delay`).
3 pre-existing backlogged conversations found via a text-pattern SQL
search over apology-style outbound replies and backfilled by hand (Velvet
Apparel, Mysolar Energy Ltd → `wrong_number`; The Heritage Specialist
Clinics → `unqualified`, since "the business has closed" is a different
situation, not a wrong number — the text-pattern search over-matched and
this one needed manual judgment, worth remembering if repeating this kind
of backfill search).

**Redirect flow ("Cassy's Signature" case) — full design spec from user,
built same day.** The distinguishing case: someone says a number is wrong
*and* gives a different number to reach the right contact — this needs to
actually message the new number, not just apologize. WhatsApp Cloud API
requires a pre-approved template for the first message to any brand-new
number (24h customer-service-window rule), so this cannot be a raw AI
freeform message; it has to go through the same approved-template path
every other first contact uses.

Design (as specified by the user): acknowledge the old contact, ask for
*their* name so the new contact can be told who referred them; if given,
mention it to the new contact ("got your number from X") in the pitch; if
declined, proceed anyway with the normal process, no referral mention; if
the new contact asks how we got their number, or the old contact asks how
we got theirs, the answer is "Google". Also needed: a durable marker for
wrong-number leads (see previous item) — done first since it's simpler and
this flow builds on it.

Implementation, entirely inside `WA Inbound — Reply Handler`
(`If8jiQRRvIm6Zyks`), plus reusing the *existing* `WA Outbound —
First-Touch Sender` (`z3KarZgzcxfB1azz`) rather than duplicating its
template-send/pacing/daily-cap logic:

- **Migration** `add_redirect_flow_support`: `conversations
  .pending_redirect_phone text null` (holds the extracted new number
  between the two conversation turns this spans), `leads.referred_by_name
  text null` (read later by the AI when the new lead replies), and
  `'redirect_pending'` / `'redirected'` added to `conversations.stage`.
- **AI classifier** (`Draft Human-Like Reply` system prompt + `Reply
  Schema` structured output): two new intents. `redirect` — wrong number
  *with* an alternate number given; extracts it into a `redirectPhone`
  output field. `redirect_name_reply` — **context-dependent on conversation
  history**, not a DB stage gate: only fires when the AI's own previous
  message was the "what's your name" ask (same pattern this system already
  uses everywhere else — PDF-sent, already-greeted, Kindness-already-
  introduced are all detected by scanning history text, not flags — kept
  consistent rather than introducing a new gating mechanism). Extracts
  `referrerName` (or null if declined). Also added a general "if asked how
  we got their number, say Google" rule, and taught `confirm_yes`'s reply
  rule to open with a referral mention instead of the generic thanks when
  `Build AI Context`'s new `referredByName` field (read from
  `leads.referred_by_name`) is set.
- **Routing** (`Route By Intent`, Switch node): two new rules,
  `redirect` → `Normalize Redirect Phone` (Code node, best-effort E.164
  normalization of whatever digits the AI extracted) → `Store Pending
  Redirect` (Supabase update: `pending_redirect_phone`, `stage =
  'redirect_pending'`) → rejoins the shared `Compute Human Typing Delay`
  send pipeline. `redirect_name_reply` → `Extract Redirect Context` (Code
  node: reads back `pending_redirect_phone` from `Find Conversation For
  Lead`, validates it against `/^\+\d{10,15}$/`) → `Redirect Phone Valid?`
  (IF) → **true**: `Create Redirected Lead` (Supabase insert into `leads`,
  `status: 'queued'`, `source: 'redirect'`, `referred_by_name` set,
  `onError: continueRegularOutput` so a duplicate-phone unique-constraint
  hit degrades gracefully instead of failing the execution) — **false**:
  `Alert Kindness: Redirect Manual Follow-up` (Telegram, for when
  normalization couldn't produce a valid number — never silently drops
  it) — both converge into `Mark Old Conversation Redirected` (Supabase
  update: `stage = 'redirected'`, clears `pending_redirect_phone`) → same
  shared send pipeline. All new Switch-branch convergences onto shared
  downstream nodes follow the pattern already proven safe elsewhere in
  this workflow (mutually-exclusive Switch outputs fanning into one node
  is fine; the known bug is specifically about two IF true/false outputs
  both wired to one node, not this).
- **Why queue instead of sending the template directly from this
  workflow**: inserting `leads.status = 'queued'` lets the existing,
  already-tested `WA Outbound — First-Touch Sender` pick it up on its next
  10-minute cycle — same daily cap, send-window, and jitter protections as
  every other first-touch send, and no duplicated Meta API call logic to
  keep in sync across two workflows.
- Published as `activeVersionId 384acfe8-23a7-41de-a9df-60b02890a866`
  (wrong-number fix published separately first, then this, at
  `596c6773-8aa9-435b-b025-bbaf9481fedf`).
- **Dashboard**: `redirect_pending` / `redirected` added to
  `STAGE_LABEL`/`stageColor` in `format.ts` so they render instead of
  falling through to the generic default styling.

**Not live-tested before publish** — unlike section 12's media pipeline,
this could not be proven against a real execution first: `execute_workflow`
explicitly refuses to start a `whatsAppTrigger`-based workflow (only
Schedule/Webhook/Form/Chat/Manual triggers are startable that way), and
building full realistic pin data for `test_workflow` across this many
nodes without derivable schema was judged not worth the cost, same
tradeoff made earlier in the session for the bot-detection gate. Verified
instead by re-fetching the published graph and checking every connection,
Switch rule, and field expression matches the intended design. **Still
needs a real end-to-end test**: one message giving a wrong number + an
alternate number, a follow-up giving a name, and confirming the new lead
actually gets the template sent by the First-Touch Sender and later
mentions the referral correctly.
