import { workflow, node, trigger, sticky, placeholder, newCredential, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const scheduleTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Every 10 Minutes',
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } },
  },
  output: [{}],
});

const getCampaignSettings = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Campaign Settings',
    parameters: { resource: 'row', operation: 'getAll', tableId: 'campaign_settings', returnAll: true },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [
    { key: 'daily_send_cap', value: 100 },
    { key: 'send_jitter_seconds_min', value: 25 },
    { key: 'send_jitter_seconds_max', value: 180 },
    { key: 'send_window', value: { start: '09:00', end: '18:00', timezone: 'Africa/Lagos' } },
  ],
});

const countSentToday = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Count Sent Today',
    alwaysOutputData: true,
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'messages',
      returnAll: true,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'direction', condition: 'eq', keyValue: 'outbound' },
          { keyName: 'message_type', condition: 'eq', keyValue: 'template' },
          { keyName: 'created_at', condition: 'gte', keyValue: expr('{{ $today.toISO() }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'msg-1', created_at: '2026-08-07T08:00:00Z' }],
});

const computePacing = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compute Pacing',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const settingsRows = $('Get Campaign Settings').all();\n" +
        'const settings = {};\n' +
        'for (const row of settingsRows) settings[row.json.key] = row.json.value;\n' +
        'const dailyCap = Number(settings.daily_send_cap ?? 100);\n' +
        'const jitterMin = Number(settings.send_jitter_seconds_min ?? 25);\n' +
        'const jitterMax = Number(settings.send_jitter_seconds_max ?? 180);\n' +
        "const win = settings.send_window || { start: '09:00', end: '18:00', timezone: 'Africa/Lagos' };\n" +
        'const nowLocal = $now.setZone(win.timezone);\n' +
        "const [startH, startM] = String(win.start).split(':').map(Number);\n" +
        "const [endH, endM] = String(win.end).split(':').map(Number);\n" +
        'const minutesNow = nowLocal.hour * 60 + nowLocal.minute;\n' +
        'const withinWindow = minutesNow >= (startH * 60 + startM) && minutesNow < (endH * 60 + endM);\n' +
        'const sentToday = $input.all().length;\n' +
        'const remainingCap = Math.max(0, dailyCap - sentToday);\n' +
        'return [{ json: { dailyCap, jitterMin, jitterMax, sentToday, remainingCap, withinWindow, canSend: withinWindow && remainingCap > 0 } }];',
    },
  },
  output: [{ dailyCap: 100, jitterMin: 25, jitterMax: 180, sentToday: 0, remainingCap: 100, withinWindow: true, canSend: true }],
});

const canSendGate = ifElse({
  version: 2.3,
  config: {
    name: 'Within Window And Under Cap?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.canSend }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: '' }],
        combinator: 'and',
      },
    },
  },
});

const getFirstTouchTemplates = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Active First-Touch Templates',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'message_templates',
      returnAll: true,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'stage', condition: 'eq', keyValue: 'first_touch' },
          { keyName: 'active', condition: 'eq', keyValue: 'true' },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'tpl-1', niche_id: null, meta_template_name: 'business_intro_v1', body: 'Hi, is this {{business_name}}?' }],
});

const getQueuedLeads = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Queued Leads',
    executeOnce: true,
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'leads',
      returnAll: false,
      limit: expr('{{ $("Compute Pacing").item.json.remainingCap }}'),
      orderBy: 'created_at.asc',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'status', condition: 'eq', keyValue: 'queued' },
          { keyName: 'opted_out', condition: 'eq', keyValue: 'false' },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1', business_name: 'Acme Bakery', phone_e164: '+2348012345678', niche_id: null }],
});

const leadLoop = splitInBatches({
  version: 3,
  config: { name: 'Loop Leads (1 at a time)', parameters: { batchSize: 1 } },
});

const pickTemplateForLead = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Pick Template For Lead',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'pick-meta-template',
            name: 'metaTemplateName',
            type: 'string',
            value: expr(
              '{{ ($("Get Active First-Touch Templates").all().find(t => t.json.niche_id === $json.niche_id) || $("Get Active First-Touch Templates").all().find(t => t.json.niche_id === null))?.json.meta_template_name }}',
            ),
          },
          {
            id: 'pick-body-preview',
            name: 'bodyPreview',
            type: 'string',
            value: expr(
              '{{ ($("Get Active First-Touch Templates").all().find(t => t.json.niche_id === $json.niche_id) || $("Get Active First-Touch Templates").all().find(t => t.json.niche_id === null))?.json.body }}',
            ),
          },
        ],
      },
    },
  },
  output: [{ id: 'lead-1', business_name: 'Acme Bakery', phone_e164: '+2348012345678', niche_id: null, metaTemplateName: 'business_intro_v1', bodyPreview: 'Hi, is this {{business_name}}?' }],
});

const sendFirstTouchTemplate = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send First-Touch Template',
    onError: 'continueErrorOutput',
    parameters: {
      resource: 'message',
      operation: 'sendTemplate',
      phoneNumberId: placeholder('Your Meta WhatsApp phone_number_id (from Meta Business Manager)'),
      recipientPhoneNumber: expr('{{ $json.phone_e164 }}'),
      template: expr('{{ $json.metaTemplateName }}'),
      components: {
        component: [
          {
            type: 'body',
            bodyParameters: { parameter: [{ type: 'text', text: expr('{{ $json.business_name || "there" }}') }] },
          },
        ],
      },
    },
    credentials: { whatsAppApi: newCredential('WhatsApp Cloud API') },
  },
  output: [{ messages: [{ id: 'wamid.abc123' }], contacts: [{ wa_id: '2348012345678' }] }],
});

const markLeadSent = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Mark Lead Sent',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'leads',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Pick Template For Lead").item.json.id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'status', fieldValue: 'sent' },
          { fieldId: 'last_outbound_at', fieldValue: expr('{{ $now.toISO() }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1', status: 'sent' }],
});

const createConversation = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Create Conversation',
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'conversations',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'lead_id', fieldValue: expr('{{ $("Pick Template For Lead").item.json.id }}') },
          { fieldId: 'stage', fieldValue: 'awaiting_confirmation' },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'conv-1', lead_id: 'lead-1', stage: 'awaiting_confirmation' }],
});

const insertOutboundMessage = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Insert Outbound Message',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'messages',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'conversation_id', fieldValue: expr('{{ $json.id }}') },
          { fieldId: 'lead_id', fieldValue: expr('{{ $("Pick Template For Lead").item.json.id }}') },
          { fieldId: 'direction', fieldValue: 'outbound' },
          { fieldId: 'message_type', fieldValue: 'template' },
          { fieldId: 'template_name', fieldValue: expr('{{ $("Pick Template For Lead").item.json.metaTemplateName }}') },
          { fieldId: 'body', fieldValue: expr('{{ $("Pick Template For Lead").item.json.bodyPreview }}') },
          { fieldId: 'status', fieldValue: 'sent' },
          { fieldId: 'sent_by', fieldValue: 'system' },
          { fieldId: 'wa_message_id', fieldValue: expr('{{ $("Send First-Touch Template").item.json.messages[0].id }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'msg-1' }],
});

const humanPacingDelay = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Human-Like Pacing Delay',
    parameters: {
      resume: 'timeInterval',
      unit: 'seconds',
      amount: expr(
        '{{ Math.floor(Number($("Compute Pacing").item.json.jitterMin) + Math.random() * (Number($("Compute Pacing").item.json.jitterMax) - Number($("Compute Pacing").item.json.jitterMin))) }}',
      ),
    },
  },
  output: [{}],
});

const classifySendError = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Classify Send Error',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'not-on-whatsapp',
            name: 'notOnWhatsapp',
            type: 'boolean',
            value: expr(
              '{{ /131026|not.*whatsapp|invalid.*recipient/i.test(JSON.stringify($json.error || $json.message || "")) }}',
            ),
          },
        ],
      },
    },
  },
  output: [{ notOnWhatsapp: false }],
});

const markLeadFailed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Mark Lead Failed / Not On WhatsApp',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'leads',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Pick Template For Lead").item.json.id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'status', fieldValue: expr('{{ $json.notOnWhatsapp ? "not_on_whatsapp" : "failed" }}') },
          { fieldId: 'whatsapp_status', fieldValue: expr('{{ $json.notOnWhatsapp ? "not_on_whatsapp" : "unknown" }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1', status: 'failed' }],
});

const logSendErrorEvent = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log Send Error Event',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'events',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'lead_id', fieldValue: expr('{{ $("Pick Template For Lead").item.json.id }}') },
          { fieldId: 'type', fieldValue: 'send_error' },
          { fieldId: 'payload', fieldValue: expr('{{ JSON.stringify({ error: $json.error || $json.message || "unknown" }) }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'evt-1' }],
});

const shortErrorPause = node({
  type: 'n8n-nodes-base.wait',
  version: 1.1,
  config: {
    name: 'Short Pause After Error',
    parameters: { resume: 'timeInterval', unit: 'seconds', amount: 5 },
  },
  output: [{}],
});

const setupNote = sticky(
  '## Outbound First-Touch Sender\n\n' +
    '1. Fill in the **WhatsApp Cloud API** credential (System User permanent access token) and the **WhatsApp Campaign Supabase** credential (Project URL + service_role key from the Supabase dashboard → Project Settings → API).\n' +
    '2. Set `phoneNumberId` on the "Send First-Touch Template" node to your Meta phone_number_id.\n' +
    '3. First-touch templates must already be **approved** in Meta Business Manager — add matching rows to `message_templates` (stage=first_touch) via the app Settings page.\n' +
    '4. Daily cap / send window / jitter are read live from `campaign_settings` — edit them in the app, no redeploy needed.\n' +
    '5. "Classify Send Error" guesses whether a failure means the number isn’t on WhatsApp from the error text. Run one real failed send and adjust the regex to match the actual Graph API error code/message.',
  [scheduleTrigger, getCampaignSettings],
  { color: 4 },
);

// Wire the per-lead send + success/error branches explicitly (clearer than
// one deeply nested expression, and keeps .to()/.onError() unambiguous).
pickTemplateForLead.to(sendFirstTouchTemplate);
sendFirstTouchTemplate.to(markLeadSent.to(createConversation.to(insertOutboundMessage.to(humanPacingDelay.to(nextBatch(leadLoop))))));
sendFirstTouchTemplate.onError(classifySendError.to(markLeadFailed.to(logSendErrorEvent.to(shortErrorPause.to(nextBatch(leadLoop))))));

export default workflow('wa-outbound-first-touch', 'WA Outbound — First-Touch Sender')
  .add(scheduleTrigger)
  .to(
    getCampaignSettings.to(
      countSentToday.to(
        computePacing.to(
          canSendGate.onTrue(getFirstTouchTemplates.to(getQueuedLeads.to(leadLoop.onEachBatch(pickTemplateForLead)))),
        ),
      ),
    ),
  )
  .add(setupNote);
