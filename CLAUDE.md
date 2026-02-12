# MemePet Agent - Live Bluesky Demo

## Worktree: memepet/live-demo

**Branch**: `memepet/live-demo` (from `main` @ 1958211)
**Repo**: memepet-agent (spacezero-team/memepet-agent)
**Path**: `/Volumes/Work/memepet-agent-live`

## Hackathon Context

**MemePet** -- Autonomous Bluesky pets born from internet memes.
**Moltiverse Hackathon** ($200K) Agent Only track. **Deadline: 2026-02-15 23:59 ET**.

## Assigned Linear Issues

| Issue | Title | Priority | Status |
|-------|-------|----------|--------|
| [SPA-3955](https://linear.app/spacezero/issue/SPA-3955) | Live Bluesky pet interaction demo + bug fixes | Urgent | Todo |

## Task: SPA-3955 Live Bluesky Demo

### Objective
Run 3 meme pets in production on Bluesky, observe interactions, and fix any bugs.

### Steps
1. Verify Vercel deployment is active with all env vars configured
2. Set up QStash cron for autonomous posting and notification polling
3. Ensure 3 pets exist in `bluesky_bot_config` with valid credentials
4. Monitor autonomous posting for 2+ hours
5. Trigger and observe pet-to-pet interactions
6. Fix any bugs in posting, replies, or interaction logic
7. Verify activity logs flowing to Supabase `bluesky_post_log` table
8. Verify iOS app displays real-time updates from Supabase Realtime

### Environment Variables Required
```
SUPABASE_URL=https://REDACTED_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
BLUESKY_SERVICE_URL=https://bsky.social
ENABLE_BLUESKY_AGENT=true
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

### Architecture
- **Framework**: Next.js (Vercel deployment)
- **AI**: Gemini via `@ai-sdk/google` + `ai` SDK with Zod structured output
- **Social**: `@atproto/api` for Bluesky AT Protocol
- **Scheduling**: QStash cron -> API routes -> agent logic
- **Database**: Supabase (bluesky_bot_config, bluesky_post_log tables)

### Agent Modes
- **Proactive**: Cron triggers -> personality-based post generation -> Bluesky post
- **Reactive**: Notification polling -> mention detection -> personality-based reply
- **Interaction**: Random pet pairing -> conversation starter -> inter-pet drama

### Key Files
- `app/api/agent/cron/route.ts` -- QStash cron handler
- `app/api/agent/trigger/route.ts` -- Manual trigger endpoint
- `lib/agent/brain.ts` -- AI post generation with personality context
- `lib/agent/bluesky-client.ts` -- AT Protocol client wrapper
- `lib/agent/interaction.ts` -- Pet-to-pet interaction logic

### Dependencies
- Bluesky accounts (either self-hosted PDS or bsky.social accounts)
- Meme pets created via pipeline (at least 3 in Supabase)
- `bluesky_bot_config` rows populated with valid credentials

## Rules (CRITICAL)

### Git Workflow
- **NEVER** commit directly to `main`
- All commits go on `memepet/live-demo` branch
- **NEVER** use `git checkout` (worktree-based workflow)
- Merge to main only after user says "통과"

### Merge Process
1. Work on this branch
2. Merge main into this branch before final review
3. User manual testing
4. User says "통과" -> confirm once more
5. Fast-forward main

### Coding Standards
- TypeScript strict mode
- Zod schemas for all AI structured output
- camelCase variables, PascalCase types
- No console.log in production (use proper logger)
- Conventional commits: feat/fix/refactor/docs/test/chore

### Linear Integration
- Do NOT mark issues as Done
- Only after user says "통과" -> then mark Done

## Other Active Worktrees
- `/Volumes/Work/ig-memepet-pipeline` -- Pipeline scraping overhaul (SPA-4015, 4016, 3941, 3961)
- `/Volumes/Work/sz-memepet-testflight` -- iOS TestFlight (SPA-3957)
