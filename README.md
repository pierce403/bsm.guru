# bsm.guru

Black-Scholes-Merton tooling for spotting relative value in crypto options.

## What’s in here

- `/`: dashboard that ranks Hyperliquid markets by “imbalance” (24h sigma-move under a BSM/lognormal assumption using realized volatility).
- `/screener`: pulls live underlying mids + historical candles from Hyperliquid, estimates realized volatility, and computes BSM fair value + greeks.  
  Note: option quotes are currently *simulated* (until we wire a real options venue / orderbook).
- `/pricing`: BSM calculator + implied volatility inversion (call + put).
- `/wallet`: generates local custodial wallets and stores keystore JSONs on disk (downloadable backup). Passwords are optional (hot wallet by default).
- API routes (used by the UI):
  - `GET /api/hyperliquid/mids?coins=BTC,ETH`
  - `GET /api/hyperliquid/candles?coin=BTC&interval=1h&lookback=30d`
  - `GET /api/hyperliquid/meta`
  - `POST /api/sync/hyperliquid` (sync Hyperliquid -> local DB)
  - `GET /api/markets/summary` (read from local DB)
  - `GET /api/options/atm?symbol=BTC&spot=12345` (Deribit ATM option snapshot)
  - `GET/POST /api/wallets` + `GET /api/wallets/:address/keystore`
- Quant libs:
  - `src/lib/quant/bsm.ts` (price/greeks/implied vol)
  - `src/lib/quant/vol.ts` (realized vol)

## Local dev

```bash
./run.sh
```

This starts the dev server and continuously syncs Hyperliquid data into a local SQLite file DB (default: `./data/bsm.sqlite`).
By default `run.sh` binds Next dev to `127.0.0.1` (recommended when using the custodial wallet feature).

Tests:

```bash
pnpm test
```

Production build:

```bash
pnpm build
```

## Configure

By default we hit Hyperliquid’s public API:

- `HYPERLIQUID_API_URL` (default: `https://api.hyperliquid.xyz`)

Local DB:

- `BSM_DB_PATH` (default: `./data/bsm.sqlite`)

Wallets:

- `BSM_WALLET_DIR` (default: `./data/wallets`)
- `BSM_ALLOW_NONLOCAL_WALLET=true` (NOT recommended; disables localhost-only guard for wallet APIs)

## Next step (to make this “real”)

To actually *find mispriced options*, we need a live options venue (quotes + instrument metadata: expiry/strike/right).

If you tell me which one you mean by “Base Hyperliquid network” (HyperEVM apps, a specific Base options protocol, etc.), I can add a provider that:

1) fetches the live option chain + bid/ask  
2) computes fair value + edge + IV  
3) sorts/filters into an actual mispricing screener

## Disclaimer

For research only. Not financial advice.
