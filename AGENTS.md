# Travel Project Guidance

## Project Shape

- This is a Next.js 16, React 19, TypeScript, npm, SQLite project for a travel/hotel AI short-video generation platform.
- App routes and API routes live under `src/app`.
- Shared server/client logic lives under `src/lib`.
- Playwright E2E tests live under `tests/e2e`.
- Local tooling and launch helpers live under `scripts`.
- Developer notes live under `docs`.

## Core Commands

- Install dependencies with `npm install` when needed.
- Start local development with `npm run dev` or the supervised runner `npm run dev:auto`.
- Run type checks with `npm run typecheck`.
- Run lint with `npm run lint`.
- Run unit tests with `npm test`.
- Run E2E tests with `npm run test:e2e`.
- Run circular dependency analysis with `npm run analyze:circular`.

## Local Runtime

- The Playwright base URL is `http://127.0.0.1:3000`.
- The health endpoint is `/api/health`.
- `npm run preflight` runs before dev, build, and typecheck scripts.
- Prefer existing local service/runtime helpers over adding new process management code.

## Editing Rules

- Treat the current working tree as user-owned and potentially dirty. Do not revert unrelated changes.
- Keep generated assets, local media, `.DS_Store`, `.tmp-tests`, and build artifacts out of intentional edits unless the user specifically asks.
- Preserve established route/store naming patterns in `src/app` and `src/lib`.
- Prefer `zod` validation for structured runtime data when adding or changing API boundaries.
- Prefer existing provider/config/store helpers before adding a new abstraction.

## Frontend Rules

- Match the current app style and component structure instead of introducing a landing-page style surface.
- For UI changes, verify layout with Playwright or the in-app browser when practical.
- Keep operational screens dense, scannable, and workflow-focused.

## Verification Expectations

- For TypeScript or API changes, run `npm run typecheck` or a narrower targeted check if available.
- For shared logic in `src/lib`, run the relevant test file or `npm test`.
- For user-facing route changes, run the relevant Playwright smoke/e2e path when practical.
- Report any checks skipped because of dirty state, missing services, external API credentials, or long runtime.
