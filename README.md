# bsm.guru

Black-Scholes-Merton tooling for spotting relative value in crypto options.

## What’s in here

- `/screener`: pulls live underlying mids + historical candles from Hyperliquid, estimates realized volatility, and computes BSM fair value + greeks.  
  Note: option quotes are currently *simulated* (until we wire a real options venue / orderbook).
- `/pricing`: BSM calculator + implied volatility inversion (call + put).
- API routes (used by the UI):
  - `GET /api/hyperliquid/mids?coins=BTC,ETH`
  - `GET /api/hyperliquid/candles?coin=BTC&interval=1h&lookback=30d`
  - `GET /api/hyperliquid/meta`
- Quant libs:
  - `src/lib/quant/bsm.ts` (price/greeks/implied vol)
  - `src/lib/quant/vol.ts` (realized vol)

## Local dev

```bash
pnpm install
pnpm dev
```

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

## Next step (to make this “real”)

To actually *find mispriced options*, we need a live options venue (quotes + instrument metadata: expiry/strike/right).

If you tell me which one you mean by “Base Hyperliquid network” (HyperEVM apps, a specific Base options protocol, etc.), I can add a provider that:

1) fetches the live option chain + bid/ask  
2) computes fair value + edge + IV  
3) sorts/filters into an actual mispricing screener

## Disclaimer

For research only. Not financial advice.

