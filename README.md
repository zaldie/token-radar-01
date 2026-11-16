# Token Radar — which pre-token protocol is worth farming next?

[![Token Radar 01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/zaldie/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/zaldie/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

Entry for the [make.fun](https://make.fun/c/token-radar-01) **token-radar-01** bounty.
A protocol's launch is the token it may issue one day. This radar ranks the
protocols that record no token yet by an implied value built only from the
sealed snapshot's own figures — TVL, seven-day growth, how long the protocol
has run, and how many chains it reaches — and gives every protocol a concrete
seven-step farm plan. It does not predict whether or when a token is issued.

## Model — radar-2

```
base     = tvl_usd × 0.25
growth   = clamp(change_7d, −60, +60) per cent
growth   = 1 + 0.5 × growth/100   when growth ≤ 0
         = 1 + 0.4 × growth/100   when growth > 0
maturity = 0.6 + 0.4 × (1 − exp(−age_days / 365))   (unknown age = 180 days)
reach    = 1 + 0.02 × min(chains − 1, 5)            (max 1.10)
implied  = max(1, round(base × growth × maturity × reach))
```

A hot week is noisy, a cold week is a warning — so growth is asymmetric and
capped at ±60% (a +4448% week caps at +24%). Maturity saturates: most credit
in year one, then a plateau. No protocol name is ever special-cased; the same
function scores every row. Live-token protocols are kept separate and shown at
the market's own value (top 24 by market cap), never ranked in the board.

The board covers all 40 watchlist protocols plus every rankable pre-token
protocol below the $50M floor: **226 rows** on the 2026-11-14 snapshot.

## Farm plans

Seven steps per protocol, generated from its own category, chains, TVL and
age — never a hand-written list of names: a fresh wallet, the category's entry
action, a weekly qualifying action, a hold window (60 / 45 / 30 days by age),
claim only from the protocol's own published link, a chain-specific gas note,
and a farm log. Capital tiers from TVL: ≥$5B → $250, ≥$1B → $150,
≥$100M → $100, else $50.

## Run it

Node 22, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

Two runs write byte-identical output. `node check-gate.mjs out <snapshot.json>`
runs the gate self-check (226 rows, full watchlist coverage, ranks 1..226,
implied value non-increasing, 3–12 farm steps of 20–600 characters each).

## Layout

```
main.ts            entrypoint: reads the snapshot, writes board.json, data.js,
                   copies dashboard/ + screenshots/, writes dossier.json
lib/model.ts       the radar-2 model, farm plans, board + data.js builders
vendor/makefun-board.ts   kit library that writes dossier.json (as shipped)
dashboard/         index.html + app.css + app.js (no network, no external URLs)
screenshots/        1-board.png, 2-detail.png, 3-filtered.png
```

## License

MIT — see [LICENSE](LICENSE).
