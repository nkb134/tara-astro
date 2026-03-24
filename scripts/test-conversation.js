#!/usr/bin/env node
/**
 * Local Conversation Test Harness
 *
 * Simulates a WhatsApp conversation locally without needing WhatsApp.
 * Tests the full flow: onboarding → chart generation → multi-agent AI responses.
 *
 * Usage:
 *   node scripts/test-conversation.js                    # Interactive mode
 *   node scripts/test-conversation.js --scenario hindi    # Run preset scenario
 *   node scripts/test-conversation.js --scenario muskan   # Run Muskan-like flow
 *
 * Requires: DATABASE_URL and GEMINI_API_KEY in .env
 */
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

// Verify required env vars
const required = ['DATABASE_URL', 'GEMINI_API_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing ${key} in .env`);
    process.exit(1);
  }
}

// Import after env is loaded
const { findOrCreateUser, updateUser } = await import('../src/db/users.js');
const { handleOnboarding } = await import('../src/services/onboardingHandler.js');
const { getSessionContext, saveExchange } = await import('../src/services/sessionManager.js');
const { dispatchToAgent } = await import('../src/ai/agents/dispatcher.js');
const { AGENTS } = await import('../src/ai/agents/router.js');
const { generateHook } = await import('../src/ai/responder.js');
const { detectLanguage } = await import('../src/languages/index.js');
const { query } = await import('../src/db/connection.js');

// Test user ID (use a distinct prefix to avoid collision with real users)
const TEST_WHATSAPP_ID = 'TEST_LOCAL_001';
const SCENARIOS = {
  hindi: [
    'Hello ji',
    'mujhe apne career me guidance chahiye',
    'Nissar, 10th June 1990',
    '10:45PM',
    'Jagdalpur',
    // Post-onboarding
    'kya kahu, job chhod di maine',
    'textile field mein tha, ab garments ka business soch raha',
    'ok',
    'dhanyawaad',
  ],
  muskan: [
    'Hello',
    'I want to know about my career and health',
    '20/11/1991',
    'not entirely sure, but around 10.20am',
    'Ghaziabad',
    // Post-onboarding
    'I left my job and do not know what to do',
    'I am in textile field. Merchandising and sourcing',
    'will i be rich in future?',
    'okay thank you',
  ],
  tamil: [
    'Vanakkam',
    'en career pathi theriyanum',
    'Priya, 15 March 1988',
    'kaalai 8 mani',
    'Chennai',
    'IT field la iruken, vera velai paakanum',
    'ok nandri',
  ],
  rapid: [
    'Hello ji',
    'career guidance chahiye',
    'Nissar 10 Jun 1990 10:45PM Jagdalpur',  // All-in-one
    'job chhod di, kya karu?',
    'achha',
  ],
};

// ─── Simulated WhatsApp sender (prints to console) ───
const sentMessages = [];

function simulateSend(text) {
  sentMessages.push(text);
  console.log(`\n  🤖 Tara: ${text}\n`);
}

// ─── Core test flow ───

async function resetTestUser() {
  try {
    await query('DELETE FROM messages WHERE user_id IN (SELECT id FROM users WHERE whatsapp_id = $1)', [TEST_WHATSAPP_ID]);
    await query('DELETE FROM conversations WHERE user_id IN (SELECT id FROM users WHERE whatsapp_id = $1)', [TEST_WHATSAPP_ID]);
    await query('DELETE FROM users WHERE whatsapp_id = $1', [TEST_WHATSAPP_ID]);
  } catch {
    // Tables might not exist yet
  }
  console.log('🔄 Test user reset');
}

async function processTestMessage(messageText) {
  const user = await findOrCreateUser(TEST_WHATSAPP_ID, 'TestUser');

  // Gender detection
  if (!user.gender) {
    const malePattern = /\b(i am a man|i('m| am) male|main ladka|ladka hoon|aadmi hoon|male hoon)\b/i;
    const femalePattern = /\b(i am a woman|i('m| am) female|main ladki|ladki hoon|aurat hoon|female hoon)\b/i;
    if (malePattern.test(messageText)) {
      await updateUser(user.id, { gender: 'male' });
      user.gender = 'male';
    } else if (femalePattern.test(messageText)) {
      await updateUser(user.id, { gender: 'female' });
      user.gender = 'female';
    }
  }

  // Route: onboarding or AI conversation
  if (!user.is_onboarded) {
    const result = await handleOnboarding(user, messageText);
    simulateSend(result.response);

    // If chart was just generated, generate hook
    if (result.messageType === 'reading') {
      const { getUserByWhatsAppId } = await import('../src/db/users.js');
      const freshUser = await getUserByWhatsAppId(TEST_WHATSAPP_ID);
      const chartData = typeof freshUser.chart_data === 'string'
        ? JSON.parse(freshUser.chart_data) : freshUser.chart_data;
      const lang = freshUser.language || 'en';

      console.log('  📊 Chart generated. Generating hook...');
      const hook = await generateHook(chartData, lang);
      if (hook) {
        simulateSend(`Kundli dekhi... ek baat hai jo mujhe bahut interesting lagi.\n\n${hook}\n\nYeh sahi hai?`);
        await updateUser(freshUser.id, { chart_summary: hook });
      }
    }
    return;
  }

  // Post-onboarding: multi-agent dispatch
  const { conversationId, history } = await getSessionContext(user.id);
  const result = await dispatchToAgent(messageText, user, history);

  console.log(`  [Agent: ${result.agent} | Model: ${result.model} | Budget: ${result.tokenBudget} tokens]`);
  simulateSend(result.text);

  // Save exchange
  await saveExchange(conversationId, user.id, messageText, result.text, {
    language: result.language,
    intent: result.intent,
    model: result.model,
    responseTimeMs: result.responseTimeMs,
  });
}

// ─── Run mode ───

const args = process.argv.slice(2);
const scenarioName = args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null;

await resetTestUser();

if (scenarioName && SCENARIOS[scenarioName]) {
  // Automated scenario
  console.log(`\n🎬 Running scenario: ${scenarioName}\n${'─'.repeat(50)}`);
  const messages = SCENARIOS[scenarioName];

  for (const msg of messages) {
    console.log(`  👤 User: ${msg}`);
    try {
      await processTestMessage(msg);
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
    }
    console.log('─'.repeat(50));
  }

  console.log('\n✅ Scenario complete\n');
  process.exit(0);
} else {
  // Interactive mode
  console.log('\n💬 Interactive Conversation Test');
  console.log('   Type messages as if you were on WhatsApp.');
  console.log('   Commands: /reset (reset user), /quit (exit)\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '  👤 You: ',
  });

  rl.prompt();
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === '/quit') { process.exit(0); }
    if (input === '/reset') { await resetTestUser(); rl.prompt(); return; }

    try {
      await processTestMessage(input);
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(0, 3).join('\n'));
    }
    rl.prompt();
  });
}
