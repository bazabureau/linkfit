# Verification Plan - Production Verification Engineer

This plan details the comprehensive build and E2E verification across all targets (iOS host app, Next.js partner dashboard, and Fastify Node REST API) in the workspace `/Users/kamrannamazov/Desktop/linkfit`.

## Steps

### Step 1: Verify iOS application build compile
- **Directory**: `apps/ios`
- **Command**: `xcodebuild -project Linkfit.xcodeproj -scheme Linkfit -destination "generic/platform=iOS Simulator" clean build`
- **Expected Outcome**: Xcode compile completes successfully with exit code 0 and zero errors.

### Step 2: Verify the Fastify Node REST API (`apps/api`)
- **Directory**: `apps/api`
- **Verification Substeps**:
  1. Kill all stale Node or Vitest processes to avoid port/db resource locks.
  2. Run `npm run typecheck` and verify exit code 0.
  3. Run `npm run lint` and verify exit code 0 and exactly 0 warnings/errors.
  4. Run E2E vitest suite: `npx vitest run tests/e2e/linkfit.e2e.test.ts`.
- **Expected Outcome**: Clean typecheck/lint and 100% of the 71 E2E tests pass successfully.

### Step 3: Verify the Next.js B2B partner dashboard (`apps/partner`)
- **Directory**: `apps/partner`
- **Verification Substeps**:
  1. Start the Fastify API in development mode dynamically or as a background service: `npm run dev` in `apps/api`.
  2. Run `npm run typecheck` in `apps/partner` and verify exit code 0.
  3. Run `npm run lint` in `apps/partner` and verify exit code 0 and exactly "✔ No ESLint warnings or errors".
  4. Run `npm run build` in `apps/partner` to compile the production Next.js application.
  5. Run Playwright E2E tests: `npx playwright test`.
- **Expected Outcome**: Next.js builds successfully, all type/lint checks pass, and all 5 Playwright E2E tests pass.

### Step 4: Stop all background servers & processes
- Clean up any running background services (dev server, Node processes).

### Step 5: Document Results and Handoff
- Write a comprehensive verification report detailing every step, command run, stdout/stderr, and exit code.
- Save report at `/Users/kamrannamazov/Desktop/linkfit/.agents/orchestrator/verification_report.md`.
- Notify the Project Orchestrator via `send_message`.
