# Tremorline

Parametric earthquake catastrophe bond on [GenLayer](https://genlayer.com). Backers fund the bond, a claimant files against a USGS event, and LLM-validators read the official seismic record to settle the payout.

## How it works

1. Backers **fund the bond** in GEN.
2. A claimant **files a claim** with an epicenter, a requested amount, and a USGS FDSN evidence URL. The URL must point at the official USGS endpoint.
3. **Adjudication** runs on GenLayer: each validator fetches the USGS feed and reads the Modified Mercalli Intensity (`mmi`, 0 to 12). Validators agree within one intensity unit.
4. **Auto-settlement** pays the requested amount, capped by the pool, only on a severe shake (MMI 7 or above). Moderate and no-event claims close with no payout.

## Architecture

```
backend/quake-bond.py   GenLayer Intelligent Contract (Python, runs on the GenVM)
frontend/               React + Vite + TypeScript dashboard (genlayer-js)
```

The evidence URL is pinned to the USGS FDSN host, so adjudication always reads the authoritative source. The trigger is binary and parametric, which keeps settlement objective.

## Live deployment

- **Network**: GenLayer Studionet (chain id 61999)
- **Contract**: `0xBf0e4f70D1C39e68ac483C08F49fe2BBD32143De`

## Run locally

```bash
cd frontend
npm install
npm run dev
npm run build    # outputs frontend/dist
```

## Deploy the contract

Requires the [GenLayer CLI](https://docs.genlayer.com/) (`npx genlayer`). Set the address in `frontend/src/chain.ts` afterwards.

```bash
npx genlayer deploy --contract backend/quake-bond.py
```

## Contract methods (`QuakeBond`)

| Method | Type | Description |
|--------|------|-------------|
| `fund_bond` | write, payable | Add GEN to the catastrophe pool |
| `file_claim` | write | File a claim against a USGS FDSN event |
| `adjudicate` | write | Read the USGS feed, derive `mmi`, set the verdict |
| `auto_settle` | write | Pay out a severe-shake claim from the pool |
| `get_case` | view | Read a claim by id |
| `get_pool_balance` | view | Current pool balance |
| `get_counts` | view | `next_id \|\| ruled \|\| severe \|\| pool \|\| total_paid` |

## License

MIT
