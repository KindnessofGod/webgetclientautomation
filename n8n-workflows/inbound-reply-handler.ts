import { workflow, node, trigger, sticky, newCredential, ifElse, switchCase, languageModel, outputParser, expr } from '@n8n/workflow-sdk';

const waTrigger = trigger({
  type: 'n8n-nodes-base.whatsAppTrigger',
  version: 1,
  config: {
    name: 'WhatsApp Inbound Event',
    parameters: { updates: ['messages'] },
    credentials: { whatsAppTriggerApi: newCredential('WhatsApp Trigger') },
  },
  output: [
    {
      messages: [{ from: '2348012345678', id: 'wamid.in1', text: { body: 'Yes this is Acme Bakery' }, type: 'text' }],
      contacts: [{ profile: { name: 'Acme Bakery Owner' } }],
      metadata: { phone_number_id: '123456789' },
    },
  ],
});

const normalizeInbound = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Normalize Inbound Message',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: 'norm-phone',
            name: 'phoneE164',
            type: 'string',
            value: expr(
              '{{ ($json.messages?.[0]?.from ?? $json.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from ?? "").toString().replace(/^\\+?/, "+") }}',
            ),
          },
          {
            id: 'norm-body',
            name: 'inboundBody',
            type: 'string',
            value: expr(
              '{{ $json.messages?.[0]?.text?.body ?? $json.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ?? "" }}',
            ),
          },
          {
            id: 'norm-wamid',
            name: 'waMessageId',
            type: 'string',
            value: expr('{{ $json.messages?.[0]?.id ?? $json.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ?? "" }}'),
          },
        ],
      },
    },
  },
  output: [{ phoneE164: '+2348012345678', inboundBody: 'Yes this is Acme Bakery', waMessageId: 'wamid.in1' }],
});

const findLeadByPhone = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Find Lead By Phone',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'leads',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'anyFilter',
      filters: { conditions: [{ keyName: 'phone_e164', condition: 'eq', keyValue: expr('{{ $json.phoneE164 }}') }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1', business_name: 'Acme Bakery', niche_id: null, opted_out: false }],
});

const findConversation = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Find Conversation For Lead',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'conversations',
      returnAll: false,
      limit: 1,
      filterType: 'manual',
      matchType: 'anyFilter',
      filters: { conditions: [{ keyName: 'lead_id', condition: 'eq', keyValue: expr('{{ $("Find Lead By Phone").item.json.id }}') }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'conv-1', lead_id: 'lead-1', stage: 'awaiting_confirmation', human_takeover: false, ai_enabled: true }],
});

const logInboundMessage = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log Inbound Message',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'messages',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'conversation_id', fieldValue: expr('{{ $json.id }}') },
          { fieldId: 'lead_id', fieldValue: expr('{{ $json.lead_id }}') },
          { fieldId: 'direction', fieldValue: 'inbound' },
          { fieldId: 'message_type', fieldValue: 'text' },
          { fieldId: 'body', fieldValue: expr('{{ $("Normalize Inbound Message").item.json.inboundBody }}') },
          { fieldId: 'wa_message_id', fieldValue: expr('{{ $("Normalize Inbound Message").item.json.waMessageId }}') },
          { fieldId: 'status', fieldValue: 'delivered' },
          { fieldId: 'sent_by', fieldValue: 'contact' },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'msg-in-1' }],
});

const markLeadReplied = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Mark Lead Replied',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'leads',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Find Conversation For Lead").item.json.lead_id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'status', fieldValue: 'replied' },
          { fieldId: 'last_inbound_at', fieldValue: expr('{{ $now.toISO() }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1' }],
});

const humanTakeoverGate = ifElse({
  version: 2.3,
  config: {
    name: 'Human Already In Control?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $("Find Conversation For Lead").item.json.human_takeover }}'), operator: { type: 'boolean', operation: 'true' }, rightValue: '' }],
        combinator: 'and',
      },
    },
  },
});

const optOutGate = ifElse({
  version: 2.3,
  config: {
    name: 'Opt-Out Keyword?',
    parameters: {
      conditions: {
        options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $("Normalize Inbound Message").item.json.inboundBody }}'), operator: { type: 'string', operation: 'regex' }, rightValue: '(stop|unsubscribe|remove me|do not contact)' }],
        combinator: 'and',
      },
    },
  },
});

const sendOptOutAck = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Opt-Out Ack',
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: expr('{{ $("Normalize Inbound Message").item.json.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? $("WhatsApp Inbound Event").item.json.metadata?.phone_number_id }}'),
      recipientPhoneNumber: expr('{{ $("Normalize Inbound Message").item.json.phoneE164 }}'),
      messageType: 'text',
      textBody: "Got it — you won't hear from us again. Sorry for the interruption!",
    },
    credentials: { whatsAppApi: newCredential('WhatsApp Cloud API') },
  },
  output: [{ messages: [{ id: 'wamid.out1' }] }],
});

const markOptedOut = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Mark Opted Out',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'leads',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Find Conversation For Lead").item.json.lead_id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [{ fieldId: 'opted_out', fieldValue: 'true' }, { fieldId: 'status', fieldValue: 'opted_out' }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1' }],
});

const getNicheTemplates = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Get Pitch + Offer Templates',
    parameters: {
      resource: 'row',
      operation: 'getAll',
      tableId: 'message_templates',
      returnAll: true,
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'active', condition: 'eq', keyValue: 'true' }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'tpl-2', niche_id: null, stage: 'pitch', body: 'We design websites for businesses like yours.' }],
});

const buildAiContext = node({
  type: 'n8n-nodes-base.set',
  version: 3.5,
  config: {
    name: 'Build AI Context',
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'ctx-business', name: 'businessName', type: 'string', value: expr('{{ $("Find Lead By Phone").item.json.business_name }}') },
          { id: 'ctx-stage', name: 'stage', type: 'string', value: expr('{{ $("Find Conversation For Lead").item.json.stage }}') },
          { id: 'ctx-message', name: 'inboundBody', type: 'string', value: expr('{{ $("Normalize Inbound Message").item.json.inboundBody }}') },
          {
            id: 'ctx-pitch',
            name: 'pitchText',
            type: 'string',
            value: expr(
              '{{ ($("Get Pitch + Offer Templates").all().find(t => t.json.stage === "pitch" && t.json.niche_id === $("Find Lead By Phone").item.json.niche_id) || $("Get Pitch + Offer Templates").all().find(t => t.json.stage === "pitch" && t.json.niche_id === null))?.json.body || "" }}',
            ),
          },
          {
            id: 'ctx-offer-pdf',
            name: 'offerPdfUrl',
            type: 'string',
            value: expr(
              '{{ ($("Get Pitch + Offer Templates").all().find(t => t.json.stage === "offer" && t.json.niche_id === $("Find Lead By Phone").item.json.niche_id) || $("Get Pitch + Offer Templates").all().find(t => t.json.stage === "offer" && t.json.niche_id === null))?.json.body || "" }}',
            ),
          },
        ],
      },
    },
  },
  output: [{ businessName: 'Acme Bakery', stage: 'awaiting_confirmation', inboundBody: 'Yes this is Acme Bakery', pitchText: 'We design websites...', offerPdfUrl: '' }],
});

const openAiModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'OpenAI Model',
    parameters: { model: { __rl: true, mode: 'list', value: 'gpt-5-mini' }, options: { temperature: 0.6 } },
    credentials: { openAiApi: newCredential('OpenAI account') },
  },
});

const structuredReplyParser = outputParser({
  type: '@n8n/n8n-nodes-langchain.outputParserStructured',
  version: 1.3,
  config: {
    name: 'Reply Schema',
    parameters: {
      schemaType: 'fromJson',
      jsonSchemaExample:
        '{ "intent": "confirm_yes", "reply": "Yeah that\'s us! What\'s this about?" }',
    },
  },
});

const draftReply = node({
  type: '@n8n/n8n-nodes-langchain.agent',
  version: 3.1,
  config: {
    name: 'Draft Human-Like Reply',
    parameters: {
      promptType: 'define',
      text: expr(
        'Conversation stage: {{ $json.stage }}\nBusiness name: {{ $json.businessName }}\nOur pitch (only use if stage is awaiting_confirmation and they confirmed, or stage is pitched): {{ $json.pitchText }}\nTheir latest WhatsApp message: "{{ $json.inboundBody }}"',
      ),
      hasOutputParser: true,
      options: {
        systemMessage:
          "You are Sophie from Ikan Group, a small web design agency, texting a business owner on WhatsApp. Write like a real person on their phone, not a company: short (1-2 sentences), casual, contractions, no emojis unless they used one, no corporate phrases like 'we are excited to inform you'. Never mention you are an AI.\n\n" +
          "Classify their message intent as one of: confirm_yes (confirmed this is their business, stage=awaiting_confirmation), confirm_no (said wrong number / not their business), interested (wants the website / says yes to the offer / wants to talk further, especially after the pitch), not_interested (politely declines, says no thanks), other (anything else, e.g. a question).\n\n" +
          "Reply rules by intent:\n- confirm_yes: thank them briefly, then deliver the pitch text above in your own casual words, end asking if they'd like to see a quick idea for their site.\n- interested: say something like you'll loop in your colleague (name: Kindness) who handles new sites, and they'll reach out shortly. Do not keep selling.\n- not_interested: thank them for their time, no pressure, wish them well. Do not push back or re-pitch.\n- confirm_no: apologize for the mix-up, no further ask.\n- other: answer briefly and naturally, steering back to whether they'd want a website if it fits.\n\nAlways return both the intent and the reply text.",
      },
    },
    subnodes: { model: openAiModel, outputParser: structuredReplyParser },
  },
  output: [{ output: { intent: 'confirm_yes', reply: "Yeah that's us! What's this about?" } }],
});

const routeByIntent = switchCase({
  version: 3.4,
  config: {
    name: 'Route By Intent',
    parameters: {
      rules: {
        values: [
          { outputKey: 'interested', conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.output.intent }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'interested' }], combinator: 'and' } },
          { outputKey: 'not_interested', conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.output.intent }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'not_interested' }], combinator: 'and' } },
          { outputKey: 'confirm_yes', conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'strict' }, conditions: [{ leftValue: expr('{{ $json.output.intent }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'confirm_yes' }], combinator: 'and' } },
        ],
      },
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'other_or_confirm_no' },
    },
  },
});

const sendAiReplyText = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send AI Reply Text',
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: expr('{{ $("WhatsApp Inbound Event").item.json.metadata?.phone_number_id ?? $("Normalize Inbound Message").item.json.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id }}'),
      recipientPhoneNumber: expr('{{ $("Normalize Inbound Message").item.json.phoneE164 }}'),
      messageType: 'text',
      textBody: expr('{{ $json.output.reply }}'),
    },
    credentials: { whatsAppApi: newCredential('WhatsApp Cloud API') },
  },
  output: [{ messages: [{ id: 'wamid.out2' }] }],
});

const logAiReply = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log AI Reply',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'messages',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'conversation_id', fieldValue: expr('{{ $("Find Conversation For Lead").item.json.id }}') },
          { fieldId: 'lead_id', fieldValue: expr('{{ $("Find Conversation For Lead").item.json.lead_id }}') },
          { fieldId: 'direction', fieldValue: 'outbound' },
          { fieldId: 'message_type', fieldValue: 'text' },
          { fieldId: 'body', fieldValue: expr('{{ $("Draft Human-Like Reply").item.json.output.reply }}') },
          { fieldId: 'status', fieldValue: 'sent' },
          { fieldId: 'sent_by', fieldValue: 'ai' },
          { fieldId: 'wa_message_id', fieldValue: expr('{{ $("Send AI Reply Text").item.json.messages[0].id }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'msg-out-1' }],
});

const updateStageConfirmed = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Update Stage: Pitched',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'conversations',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Find Conversation For Lead").item.json.id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [{ fieldId: 'stage', fieldValue: 'pitched' }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'conv-1' }],
});

const sendOfferPdf = node({
  type: 'n8n-nodes-base.whatsApp',
  version: 1.1,
  config: {
    name: 'Send Offer PDF (If Configured)',
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'message',
      operation: 'send',
      phoneNumberId: expr('{{ $("WhatsApp Inbound Event").item.json.metadata?.phone_number_id ?? $("Normalize Inbound Message").item.json.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id }}'),
      recipientPhoneNumber: expr('{{ $("Normalize Inbound Message").item.json.phoneE164 }}'),
      messageType: 'document',
      mediaPath: 'useMediaLink',
      mediaLink: expr('{{ $("Build AI Context").item.json.offerPdfUrl }}'),
    },
    credentials: { whatsAppApi: newCredential('WhatsApp Cloud API') },
  },
  output: [{ messages: [{ id: 'wamid.out3' }] }],
});

const updateStageInterested = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Update Stage: Hot Lead + Handoff',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'conversations',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Find Conversation For Lead").item.json.id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'stage', fieldValue: 'hot_lead' },
          { fieldId: 'human_takeover', fieldValue: 'true' },
          { fieldId: 'ai_enabled', fieldValue: 'false' },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'conv-1' }],
});

const markLeadHotLead = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Mark Lead Hot',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'leads',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Find Conversation For Lead").item.json.lead_id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [{ fieldId: 'status', fieldValue: 'hot_lead' }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1' }],
});

const logHotLeadEvent = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Log Hot Lead Event',
    parameters: {
      resource: 'row',
      operation: 'create',
      tableId: 'events',
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'lead_id', fieldValue: expr('{{ $("Find Conversation For Lead").item.json.lead_id }}') },
          { fieldId: 'conversation_id', fieldValue: expr('{{ $("Find Conversation For Lead").item.json.id }}') },
          { fieldId: 'type', fieldValue: 'hot_lead' },
          { fieldId: 'payload', fieldValue: expr('{{ JSON.stringify({ businessName: $("Find Lead By Phone").item.json.business_name, lastMessage: $("Normalize Inbound Message").item.json.inboundBody }) }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'evt-hot-1' }],
});

const updateStageNotInterested = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Update Stage: Closed (Not Interested)',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'conversations',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Find Conversation For Lead").item.json.id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [{ fieldId: 'stage', fieldValue: 'closed' }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'conv-1' }],
});

const markLeadNotInterested = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Mark Lead Not Interested',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'leads',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ $("Find Conversation For Lead").item.json.lead_id }}') }] },
      dataToSend: 'defineBelow',
      fieldsUi: { fieldValues: [{ fieldId: 'status', fieldValue: 'not_interested' }] },
    },
    credentials: { supabaseApi: newCredential('WhatsApp Campaign Supabase') },
  },
  output: [{ id: 'lead-1' }],
});

const setupNote = sticky(
  '## Inbound Reply Handler\n\n' +
    "1. Fill in **WhatsApp Trigger** (Client ID + Secret from your Meta App) and **WhatsApp Cloud API** (System User access token) credentials. There is no manual verify-token field — Meta's webhook verification is automatic for this node.\n" +
    '2. **IMPORTANT**: "Normalize Inbound Message" guesses the payload shape from Meta’s standard webhook format. Send yourself one real test message, open the execution, and confirm `phoneE164` / `inboundBody` populated correctly — adjust the expression if the trigger normalizes fields differently.\n' +
    '3. Add `pitch` and `offer` rows to `message_templates` per niche (offer.body = a public PDF URL) via the app Settings page — this is what "Send Offer PDF" sends.\n' +
    "4. If a lead replies whose phone number isn't in `leads` yet, or before any conversation row exists for them, this workflow intentionally does nothing (no conversation to attach the message to) — expected for truly cold inbound contacts.\n" +
    '5. When `human_takeover` is true on a conversation (owner took over in the app), the AI does not reply — the message is only logged.',
  [waTrigger, normalizeInbound],
  { color: 4 },
);

const credentialWarning = sticky(
  "## ⚠️ Same credential warning as the outbound workflow\n\nAll Supabase nodes here need the real **WhatsApp Campaign Supabase** credential (project uqnqcywnileazxirzyxv), not whatever gets auto-assigned. Check every Supabase node before activating.",
  [],
  { color: 3 },
);

// IMPORTANT: ifElse()/switchCase() branch methods (.onTrue/.onFalse/.onCase)
// do NOT mutate their node in place — unlike plain .to(), their return value
// must be consumed by a .to() call (bare or inline, doesn't matter) or the
// branch is silently dropped from the compiled graph. Plain node .to() calls
// mutate in place and can be bare statements in any order.
sendOptOutAck.to(markOptedOut);

getNicheTemplates.to(buildAiContext);
buildAiContext.to(draftReply);

updateStageInterested.to(markLeadHotLead.to(logHotLeadEvent.to(sendAiReplyText)));
updateStageNotInterested.to(markLeadNotInterested.to(sendAiReplyText));
updateStageConfirmed.to(sendOfferPdf.to(sendAiReplyText));
sendAiReplyText.to(logAiReply);

findLeadByPhone.to(findConversation);
findConversation.to(logInboundMessage);
logInboundMessage.to(markLeadReplied);
markLeadReplied.to(humanTakeoverGate.onFalse(optOutGate.onTrue(sendOptOutAck).onFalse(getNicheTemplates)));

draftReply.to(
  routeByIntent
    .onCase(0, updateStageInterested)
    .onCase(1, updateStageNotInterested)
    .onCase(2, updateStageConfirmed)
    .onCase(3, sendAiReplyText),
);

export default workflow('wa-inbound-reply-handler', 'WA Inbound — Reply Handler')
  .add(waTrigger)
  .to(normalizeInbound.to(findLeadByPhone))
  .add(setupNote)
  .add(credentialWarning);
