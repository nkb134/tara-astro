#!/usr/bin/env node
/**
 * Local Conversation Test Harness — Full Flow
 *
 * Real Gemini calls + real Swiss Ephemeris chart generation.
 * Mock: WhatsApp sender, PostgreSQL (in-memory user state).
 *
 * Usage: node test/conversation-test.js [scenario]
 * Scenarios: hindi-career, english-marriage, hinglish-casual, rapid-fire, all
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Suppress logs
process.env.LOG_LEVEL = 'silent';

// Mock env vars
process.env.WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || 'test';
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || 'test';
process.env.META_APP_SECRET = process.env.META_APP_SECRET || 'test';
process.env.WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'test';

// ── DB Mock Strategy ────────────────────────────────────────
// We set DATABASE_URL to empty so the connection module returns { rows: [] }
// for all queries. The onboarding handler will call updateUser which silently
// no-ops. We track user state by capturing the result.chartData from
// handleOnboarding and manually updating our testUser object.
delete process.env.DATABASE_URL;

// Global test state
let testUser = null;
let testConversationHistory = [];

// ── Now import the actual handlers ──────────────────────────
const { handleOnboarding } = await import('../src/services/onboardingHandler.js');
const { dispatchToAgent } = await import('../src/ai/agents/dispatcher.js');
const { generateHook } = await import('../src/ai/responder.js');
const { detectLanguage, detectScript } = await import('../src/languages/index.js');

// ── Quality Validators ──────────────────────────────────────

const BANNED = [
  'as an ai', 'i am an ai', 'language model', 'artificial intelligence',
  'main ek AI', 'main AI hoon', 'i am a bot', 'chatbot', 'virtual assistant',
];
const DEVANAGARI_RE = /[\u0900-\u097F]/;

function validate(text, ctx = {}) {
  const issues = [];
  const lower = text.toLowerCase();
  const sentences = text.split(/[.!?।]+/).filter(s => s.trim().length > 5);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const splits = text.split(/\n---\n/).length;

  if (sentences.length > 8) issues.push(`TOO_LONG: ${sentences.length} sentences`);
  for (const p of BANNED) { if (lower.includes(p)) issues.push(`BANNED: "${p}"`); }
  if (ctx.script === 'latin' && DEVANAGARI_RE.test(text)) issues.push(`WRONG_SCRIPT: Devanagari in Latin session`);
  if (/^(Achha toh|Dekho\b|So\.{0,3}\s|Interesting)/i.test(text)) issues.push(`PREAMBLE`);
  if (ctx.agent === 'followup' && words.length > 30) issues.push(`FOLLOWUP_LONG: ${words.length}w`);
  if (splits > 2) issues.push(`SPLITS: ${splits} (max 2)`);

  return { ok: issues.length === 0, issues, sentences: sentences.length, words: words.length };
}

// ── Scenarios ───────────────────────────────────────────────

const SCENARIOS = {
  'hindi-career': {
    name: 'Hindi Career — Full Flow with Chart',
    script: 'latin',
    steps: [
      { input: 'Hello ji', phase: 'onboarding' },
      { input: 'mujhe career mein guidance chahiye', phase: 'onboarding' },
      { input: 'Nissar, 10 June 1990', phase: 'onboarding' },
      { input: '10:45PM', phase: 'onboarding' },
      { input: 'Jagdalpur', phase: 'onboarding' },  // → chart generated + hook
      { input: 'meri job mein bahut stress hai, kya karun?', phase: 'ai' },
      { input: 'achha', phase: 'ai' },
      { input: 'kya upaay hai?', phase: 'ai' },
    ],
  },
  'english-marriage': {
    name: 'English Marriage — Full Flow',
    script: 'latin',
    steps: [
      { input: 'Hi', phase: 'onboarding' },
      { input: 'I want to know about my marriage prospects', phase: 'onboarding' },
      { input: 'Muskan, 20/11/1991', phase: 'onboarding' },
      { input: 'around 10:20am', phase: 'onboarding' },
      { input: 'Ghaziabad', phase: 'onboarding' },
      { input: 'will I get married this year?', phase: 'ai' },
      { input: 'what about children?', phase: 'ai' },
      { input: 'okay thank you', phase: 'ai' },
    ],
  },
  'hinglish-casual': {
    name: 'Hinglish Casual — Rapport First',
    script: 'latin',
    steps: [
      { input: 'Hello ji', phase: 'onboarding' },
      { input: 'mein badhiya hoon, aap kaise hain?', phase: 'onboarding' },
      { input: 'career guidance chahiye', phase: 'onboarding' },
    ],
  },
  'rapid-fire': {
    name: 'Rapid Fire — Multiple Messages',
    script: 'latin',
    steps: [
      // Simulate what debounce would produce (joined messages)
      { input: 'Hello ji\nmein badhiya\naap kaise hain', phase: 'onboarding' },
      { input: 'career mein help chahiye\nmujhe bahut tension hai', phase: 'onboarding' },
    ],
  },
};

// ── State Inference (since updateUser is a no-op) ───────────

function inferStateUpdate(user, input, response, messageType) {
  const resp = response.toLowerCase();

  // Step: new → awaiting_topic (greeting detected)
  if (user.onboarding_step === 'new' && (resp.includes('kisme madad') || resp.includes('what can i help') || resp.includes('enna help'))) {
    user.onboarding_step = 'awaiting_topic';
    user.language = detectLanguage(input);
    const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : user.preferences;
    prefs.script = detectScript(input);
    user.preferences = JSON.stringify(prefs);
    return;
  }

  // Step: new → awaiting_name_dob (topic-specific request)
  if (user.onboarding_step === 'new' && ((resp.includes('naam') && resp.includes('tithi')) || (resp.includes('name') && resp.includes('birth')))) {
    user.onboarding_step = 'awaiting_name_dob';
    user.language = detectLanguage(input);
    const prefs = typeof user.preferences === 'string' ? JSON.parse(user.preferences || '{}') : user.preferences;
    prefs.script = detectScript(input);
    user.preferences = JSON.stringify(prefs);
    return;
  }

  // Step: awaiting_topic → awaiting_topic (casual chat, no transition)
  if (user.onboarding_step === 'awaiting_topic' && resp.includes('badhiya') && resp.includes('madad karun')) {
    return;
  }

  // Step: awaiting_topic → awaiting_name_dob (topic given)
  if (user.onboarding_step === 'awaiting_topic' && ((resp.includes('naam') && resp.includes('tithi')) || (resp.includes('name') && resp.includes('birth')))) {
    user.onboarding_step = 'awaiting_name_dob';
    return;
  }

  // Step: awaiting_name_dob → awaiting_time (name+DOB parsed)
  if (resp.includes('samay pata') || resp.includes('birth time') || resp.includes('neram theriyuma') || resp.includes('samayam telusaa') || resp.includes('somoy jaanen')) {
    user.onboarding_step = 'awaiting_time';
    // Extract name from response pattern "{name} ji 😊"
    const nameMatch = response.match(/^(\w+)\s+ji/i);
    if (nameMatch) user.display_name = nameMatch[1];
    // Set a placeholder birth_date (the real parser ran but couldn't persist)
    if (!user.birth_date) user.birth_date = '1990-06-10';
    return;
  }

  // Step: awaiting_time → awaiting_place (time parsed)
  if (resp.includes('kahan paida') || resp.includes('where were you born') || resp.includes('city bata') || resp.includes('enga pirandh') || resp.includes('ekkada puttar') || resp.includes('kothay jonme') || resp.includes('evide janich') || resp.includes('ellige hutti')) {
    user.onboarding_step = 'awaiting_place';
    // Set time from input
    const timeMatch = input.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1]);
      const m = parseInt(timeMatch[2] || '0');
      const p = timeMatch[3].toLowerCase();
      if (p === 'pm' && h !== 12) h += 12;
      if (p === 'am' && h === 12) h = 0;
      user.birth_time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
      user.birth_time_known = true;
    }
    return;
  }

  // Step: awaiting_place → onboarded (chart generated)
  if (messageType === 'reading') {
    user.onboarding_step = 'onboarded';
    user.is_onboarded = true;
    user.birth_place = input.trim();
    return;
  }
}

// ── Runner ──────────────────────────────────────────────────

function newUser() {
  return {
    id: 1, whatsapp_id: '910000000000', display_name: null,
    language: 'en', onboarding_step: 'new', is_onboarded: false,
    gender: null, birth_date: null, birth_time: null, birth_time_known: true,
    birth_place: null, birth_lat: null, birth_lng: null, birth_timezone: null,
    chart_data: null, chart_summary: null, is_first_session_used: false,
    preferences: '{}',
  };
}

async function runScenario(key) {
  const sc = SCENARIOS[key];
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  🔮 ${sc.name}`);
  console.log(`${'═'.repeat(60)}\n`);

  testUser = newUser();
  testConversationHistory = [];
  let issues = 0;

  for (let i = 0; i < sc.steps.length; i++) {
    const { input, phase } = sc.steps[i];
    const t0 = Date.now();
    let response = '', agent = 'onboarding', hookText = '';

    console.log(`  👤 "${input}"`);

    try {
      if (phase === 'onboarding' && !testUser.is_onboarded) {
        const result = await handleOnboarding(testUser, input);
        response = result.response;
        agent = result.messageType;

        // Infer state changes from the response (since updateUser is a no-op)
        inferStateUpdate(testUser, input, response, result.messageType);

        // If chart was generated, capture chart_data and generate hook
        if (result.messageType === 'reading' && result.chartData) {
          testUser.chart_data = JSON.stringify(result.chartData);
          testUser.is_onboarded = true;
          testUser.onboarding_step = 'onboarded';

          // Generate hook (real Gemini call)
          const lang = testUser.language || 'en';
          const prefs = typeof testUser.preferences === 'string'
            ? JSON.parse(testUser.preferences || '{}') : testUser.preferences;
          const script = prefs.script || 'latin';

          try {
            const hook = await generateHook(result.chartData, lang, script);
            if (hook) {
              hookText = hook;
              testUser.chart_summary = hook;
            }
          } catch (err) {
            console.log(`  ⚠️  Hook generation failed: ${err.message}`);
          }
        }
      } else {
        // Post-onboarding AI
        const result = await dispatchToAgent(input, testUser, testConversationHistory);
        response = result.text || '';
        agent = result.agent;
        if (!response || response.length === 0) {
          console.log(`  ⚠️  Empty response from ${agent} (model: ${result.model}, budget: ${result.tokenBudget})`);
          // Check if chart_data exists
          const hasChart = testUser.chart_data && testUser.chart_data !== '{}';
          console.log(`  ℹ️  chart_data: ${hasChart ? 'present (' + String(testUser.chart_data).length + ' chars)' : 'MISSING'}`);
        }
      }
    } catch (err) {
      console.log(`  ❌ ${err.message}`);
      issues++;
      continue;
    }

    const elapsed = Date.now() - t0;

    // Clean preambles (like the real handler does)
    const cleaned = response
      .replace(/^(Achha toh\.{0,3}|Dekho\.{0,3}|So\.{0,3}|Hmm\.{0,3}|Interesting\.{0,3})\s*\n+/i, '')
      .trim();

    // Split for display (max 2)
    const parts = cleaned.split(/\n---\n/).map(p => p.trim()).filter(p => p);
    const displayParts = parts.slice(0, 2);
    if (parts.length > 2) {
      displayParts[1] = parts.slice(1).join('\n\n');
    }

    for (const part of displayParts) {
      const truncated = part.length > 120 ? part.substring(0, 120) + '...' : part;
      console.log(`  🤖 ${truncated}`);
    }

    // Show hook if generated
    if (hookText) {
      const hookTrunc = hookText.length > 120 ? hookText.substring(0, 120) + '...' : hookText;
      console.log(`  ✨ Hook: ${hookTrunc}`);
    }

    // Validate
    const v = validate(response, { script: sc.script, agent });
    if (!v.ok) {
      for (const iss of v.issues) console.log(`  ⚠️  ${iss}`);
      issues += v.issues.length;
    }

    // Validate hook separately
    if (hookText) {
      const hv = validate(hookText, { script: sc.script, agent: 'hook' });
      if (!hv.ok) {
        for (const iss of hv.issues) console.log(`  ⚠️  Hook: ${iss}`);
        issues += hv.issues.length;
      }
    }

    console.log(`  ⏱️  ${elapsed}ms | ${v.words}w ${v.sentences}s | ${agent}\n`);

    // Track history
    testConversationHistory.push(
      { role: 'user', content: input },
      { role: 'assistant', content: response + (hookText ? '\n' + hookText : '') }
    );
  }

  const icon = issues === 0 ? '✅' : '⚠️';
  console.log(`  ${icon} ${sc.name}: ${issues} issue(s)\n`);
  return issues;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2] || 'all';

  console.log('\n🔮 Tara Conversation Test Harness (Full)');
  console.log('   Real Gemini + Real Charts | Mock DB + WhatsApp\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY required in .env');
    process.exit(1);
  }

  const keys = arg === 'all' ? Object.keys(SCENARIOS) : arg.split(',');
  let total = 0;
  const results = [];

  for (const k of keys) {
    if (!SCENARIOS[k]) { console.error(`Unknown: ${k}. Available: ${Object.keys(SCENARIOS).join(', ')}`); continue; }
    try {
      const n = await runScenario(k);
      total += n;
      results.push({ name: SCENARIOS[k].name, issues: n });
    } catch (err) {
      console.error(`💥 ${k}: ${err.message}\n${err.stack}`);
      total++;
      results.push({ name: k, issues: 1 });
    }
  }

  console.log(`${'═'.repeat(60)}`);
  console.log('  RESULTS');
  console.log(`${'═'.repeat(60)}`);
  for (const r of results) {
    console.log(`  ${r.issues === 0 ? '✅' : '⚠️'}  ${r.name}: ${r.issues} issue(s)`);
  }
  console.log(`\n  Total: ${total} issue(s) ${total === 0 ? '✅' : '⚠️'}`);
  console.log(`${'═'.repeat(60)}\n`);
  process.exit(total > 0 ? 1 : 0);
}

main();
