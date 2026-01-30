# logs/

This directory is for local-only runtime logs (not committed to git).

Expected files:
- `analysis.log` - analysis output / signals / screener results
- `trade.log` - trade intents + execution records
- `wallet.log` - wallet API interactions (no private keys)
- `error.log` - errors + stack traces

`logs/README.md` is committed so the folder exists in the repo. All other files in
`logs/` are ignored via `.gitignore`.
