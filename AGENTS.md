# AGENTS.md

This file is a living playbook for anyone (human or AI agent) working on `bsm.guru`.
Keep it short, concrete, and current.

It is inspired by the workflow in `https://recurse.bot`: leave breadcrumbs for the next agent, and leave *yourself* a better situation than you found.

## Project Goal

Build a clean, fast web app that uses Black-Scholes-Merton (BSM) as a baseline to spot potentially mispriced crypto options. Today we:

- Fetch live underlying mids + historical candles from Hyperliquid.
- Estimate realized volatility from candles.
- Compute BSM prices/greeks + implied vol.
- Show a screener UI (NOTE: option quotes are currently simulated until a real options venue is wired in).

## Quick Start

```bash
pnpm install
pnpm dev
```

Quality gates:

```bash
pnpm lint
pnpm test
pnpm build
```

## Repo Map

- App routes (Next App Router): `src/app/*`
  - Landing: `src/app/page.tsx`
  - Screener UI: `src/app/screener/screener-client.tsx`
  - Pricing sandbox: `src/app/pricing/pricing-client.tsx`
  - About: `src/app/about/page.tsx`
- API routes:
  - `GET /api/hyperliquid/mids` -> `src/app/api/hyperliquid/mids/route.ts`
  - `GET /api/hyperliquid/candles` -> `src/app/api/hyperliquid/candles/route.ts`
  - `GET /api/hyperliquid/meta` -> `src/app/api/hyperliquid/meta/route.ts`
- Hyperliquid client helpers: `src/lib/hyperliquid/info.ts`
- Quant library:
  - Normal CDF/PDF: `src/lib/quant/normal.ts`
  - BSM price/greeks/IV: `src/lib/quant/bsm.ts`
  - Realized vol: `src/lib/quant/vol.ts`
  - Tests: `src/lib/quant/*.test.ts`
- UI primitives: `src/components/ui/*`

## Data Sources / Assumptions

- Hyperliquid public API (`/info`) is used for:
  - `allMids` (underlying mid)
  - `candleSnapshot` (historical closes)
  - `meta` (universe list)
- Configure API base URL via `HYPERLIQUID_API_URL` (defaults to `https://api.hyperliquid.xyz`).
- No options chain is integrated yet. In the screener, "market option mids" are simulated via a deterministic function in `src/app/screener/screener-client.tsx` (`pseudoMisprice`).

## Known Pitfalls (Read This If Things Break)

- Next/Turbopack can infer the wrong workspace root if there are other lockfiles on the machine; we pin it:
  - `next.config.ts` sets `turbopack.root` to this project directory.
- TypeScript can accidentally pick up global `@types/*` from outside the repo on some machines; we constrain:
  - `tsconfig.json` sets `"typeRoots": ["./node_modules/@types"]`.

## How To Extend To "Real Mispriced Options"

We need an options venue/provider with:

- Instrument metadata: underlying, expiry, strike, right, settlement rules
- Live quotes: bid/ask or mid (ideally full orderbook)

Implementation sketch:

1) Add a provider module under `src/lib/options-providers/<name>.ts`
2) Add Next API routes under `src/app/api/options/<name>/*` (hide keys server-side)
3) Replace `pseudoMisprice` flow with fetched mids/bid/ask
4) Compute: fair, edge, IV, greeks; sort/filter and render a real chain table

If a user says "Base Hyperliquid network", clarify what that means (HyperEVM app? Base L2 protocol? specific endpoint).

## Collaboration Style (For Agents)

Guidelines adapted from `recurse.bot` (paraphrased):

- Work in small steps that can be validated (lint/test/build, or a focused UI check).
- When a task is complete and validated, **commit and push** (small, descriptive commits).
- Be explicit about unknowns; ask a single sharp clarifying question when blocked.
- Prefer leaving notes + guardrails over heroics (the next agent should not have to rediscover gotchas).
- When you learn something important, update this file immediately.

### Rapport Cues (What the user seems to want)

- "Nice pretty website" matters: polish, typography, and layout are a feature.
- React + TypeScript + Tailwind are preferred.
- Avoid generic boilerplate UI; aim for intentional visual direction.

## Update Log (Append Only, Keep Short)

- 2026-01-29: Bootstrapped Next.js + TS + Tailwind; added BSM/IV/vol libs + tests; added Hyperliquid API routes; built Screener + Pricing pages; fixed Turbopack root + TS typeRoots pitfalls.
