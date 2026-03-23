# CLAUDE.md — Tara Project Guidelines

## Project Overview
WhatsApp-based Vedic Jyotish companion called Tara.
Full spec in tara-spec.md. Read it before any work.

## Tech Stack (DO NOT deviate)
- Runtime: Node.js 20+ with Express.js
- Language: JavaScript ES Modules
- Database: PostgreSQL via pg (node-postgres)
- LLM: Google Gemini via @google/generative-ai
- Vector DB: Pinecone via @pinecone-database/pinecone
- Jyotish calculations: VedAstro API (HTTP calls via axios)
- WhatsApp: Meta Cloud API (direct HTTP, no SDK)

## Coding Standards
- Use ES Modules (import/export, not require)
- Use async/await, never raw promises
- Use Pino for all logging
- Never log user birth data or message content
- All API calls must have try/catch with retry logic
- Keep functions small and single-purpose

## Architecture Rules
- LLM calls MUST go through src/ai/llmProvider.js abstraction
- NEVER hardcode Gemini — it must be swappable via LLM_PROVIDER env var
- Language/locale MUST go through src/languages/ config layer
- All user-facing text must support Tamil, Hindi, Telugu, Bengali, Malayalam, Kannada, English
- Tara NEVER identifies herself as AI in responses
- Tara speaks as a human woman — warm, personal, emotional

## What NOT to Do
- Do NOT use TypeScript
- Do NOT use ORMs (Sequelize, Prisma) — use raw pg queries
- Do NOT hardcode API keys — always use process.env
- Do NOT build all phases at once
- Do NOT add AI/bot disclaimers in user-facing messages

## Verification Rules (MANDATORY)

After EVERY code change, you MUST:

1. SELF-REVIEW: Before pushing, use subagent qa-reviewer to review all changed files
2. TRACE THE FLOW: Mentally walk through at least 2 conversation scenarios
   (one Hindi, one Tamil) and verify each message is correct
3. CHECK LANGUAGES: Verify that every user-facing string exists in ALL 7 language files
4. CHECK BANNED PHRASES: Grep for banned phrases from tara-character.json in all code
5. TEST PARSING: For any parser changes, verify these inputs work:
   - "Nissar 10 Jun 1990" → name + DOB
   - "11:45PM Jagdalpur" → time + place
   - "don't know" → unknown time flag
   - "jagdalpur, chattisgarh" → geocode succeeds
6. CHECK ERROR PATHS: For any API integration, verify what happens when it fails

After pushing, run:
- curl https://tara-astro-production.up.railway.app/health (verify deployed)
- Check Railway logs for any startup errors

## Compounding Errors Log
Every time a bug is found during testing, add it here so it never happens again:

- BUG: Language switches to English during onboarding when user sends name/date
  FIX: Store language from first message, never re-detect from neutral inputs
- BUG: Geocoding fails for Indian Tier 2/3 cities
  FIX: Local india-cities.json (716 cities) checked before API
- BUG: Error message repeated 3 times
  FIX: Track last error, never send same error within 60 seconds
- BUG: Combined time+place input ignored
  FIX: Parser must extract all fields from single message
- BUG: No greeting/self-introduction in first message
  FIX: First message MUST always include "Main Tara hoon" / "Naan Tara"
- BUG: Onboarding messages too curt and mechanical
  FIX: Follow pattern: Warmth → Reassurance → Ask → Set expectation
