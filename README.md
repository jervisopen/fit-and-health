# ourfitnesspal (working name)

Self-hosted, mobile-first nutrition diary with Indian serving sizes, photo meal logging (Snap)
and an intermittent-fasting tracker. See [docs/BLUEPRINT.md](docs/BLUEPRINT.md) for the design.

> Working name only. It is close to a commercial trademark, so pick a distinct name before publishing.

## Requirements

- Node.js 24+ (uses the built-in `node:sqlite` with FTS5, and runs `.ts` files directly)

## Food database

The repository ships **code only**. Every install downloads its own copy of the open datasets
into `data/raw/` (gitignored), then builds the local database.

```sh
npm install
npm run data:fetch      # INDB + IFCT 2017 (~2.4 MB), Open Food Facts India subset (slow, resumable)
npm run data:build      # → var/app.db  (rebuild anytime; diary data is kept)
npm run db:search -- "aloo paratha"
npm run db:search -- --meal B "poha"
```

| Source | What it gives | Terms |
|---|---|---|
| [INDB, Anuvaad 2024.11](https://www.anuvaad.org.in/indian-nutrient-databank/) | 1,014 prepared Indian recipes with household servings (bowl, roti, idli, katori…) | Open access, no explicit licence. Cite Vijayakumar et al., *Curr Dev Nutr* 2024 |
| [IFCT 2017](https://www.nin.res.in/) via [nodef/ifct2017](https://github.com/nodef/ifct2017) | 542 raw ingredients, full micronutrients, names in 15+ Indian languages | Data © ICMR-NIN; packaging AGPL-3.0-or-later |
| [Open Food Facts](https://world.openfoodfacts.org/) | Packaged foods sold in India, with barcodes | ODbL 1.0 (database), DbCL (contents) |

Data notes:
- **Deep-fried INDB recipes are flagged** (`data_quality = 'suspect_frying_oil'`, 123 foods). INDB
  counts all frying oil as eaten, so these read 600–800 kcal/100 g. They rank lower in search and
  the app shows a warning.
- Open Food Facts rows are dropped when calories disagree badly with 4·P + 4·C + 9·F.
- OFF throttles bulk reads hard (about 6 product reads a minute in practice). `data:fetch -- off`
  resumes from `data/raw/off/cache.jsonl`, and `data:build` uses whatever is cached so far.
- Household weights we authored ourselves (`data/seeds/`) are marked `is_estimated`.

## Running the app

```sh
npm run build       # build the PWA into apps/web/dist
npm start           # http://localhost:8787 serves the API and the app
```

Install it from the browser menu ("Add to Home screen") on a phone on the same network.
Copy `.env.example` to `.env` to change the port or database location.

## Snap (photo meal logging)

Photograph a plate → a vision model lists each food with a household portion and a box on the photo
→ each item is matched to the food database → you tick, fix portions or swap foods → one tap logs
them to the diary (with the photo as a thumbnail).

Configure the model in `.env` (see `.env.example`). The key never leaves the server:

| `VISION_PROVIDER` | Needs | Notes |
|---|---|---|
| `anthropic` | `VISION_API_KEY` (or `ANTHROPIC_API_KEY`) | Official SDK, default model `claude-opus-5-5`, structured output, server-side refusal fallback. `VISION_EFFORT` optional (default `medium`). |
| `openai` | `VISION_API_KEY`, `VISION_MODEL` | Chat Completions with a strict JSON schema. |
| `gemini` | `VISION_API_KEY`, `VISION_MODEL` | `generateContent` in JSON mode. |
| `openai_compatible` | `VISION_BASE_URL`, `VISION_MODEL` | Local models via Ollama, vLLM, LM Studio… |
| `mock` | nothing | Same sample thali for every photo; `npm run dev:api:mock` uses it. |

Photos are resized in the browser (≈1280 px JPEG) and stored under `DATA_DIR/snaps/`. Each Snap
sends one image to the provider you configured, and that provider's pricing and data policy apply.
On Android Chrome, the Snap tab can also scan barcodes with the camera.

## Fasting tracker

- **Daily schedule** (e.g. 16:8 from 8 PM): fasts are tracked automatically; start or end any day's
  fast early, or edit it afterwards. Windows are anchored to your time zone, even if the server runs in UTC.
- **Start & stop**: a plain timer for irregular fasts.
- Presets 12:12 → OMAD, stages from 0 h to 48 h+, streaks (consecutive days with a goal-met fast),
  7-day chart and history.
- Reminders: the plan sheet offers an `.ics` calendar file with a daily alert 30 min before each fast
  and one when it ends. A self-hosted PWA can't send notifications while it's closed without a push server.
- Stage descriptions are general information, not medical advice.

## Development

```sh
npm run dev:api     # API on :8787, restarts on change
npm run dev:web     # Vite on :5173, proxies /api to :8787 (set API_PORT to change)
npm test            # node:test suites (API, search, ingest, shared)
npm run typecheck   # server + web
npm run db:migrate  # apply schema migrations to var/app.db
```

Layout: `apps/server` (Hono API + SQLite), `apps/web` (React PWA), `packages/shared`
(nutrient registry, meal types, goal calculator, API types), `data/ingest` (fetch/build pipeline),
`data/seeds` (our own units, densities, synonyms).
