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
