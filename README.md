# fit&health

**Track what you eat, the Indian way, without paying rent on your own health data.**

Popular nutrition apps have turned the basics into a subscription. Logging a meal from a photo,
seeing your vitamins and minerals, even a fasting timer can sit behind a paywall, while the app
nudges you toward premium plans and coaches at every turn. Knowing what's on your plate shouldn't
cost a monthly fee.

fit&health is the free, open-source alternative. Open the website and start logging: no sign-up,
no download, and your diary stays on your phone. Prefer your own server? Self-host it instead.

- **Food diary built for Indian food.** Log in katoris, rotis, bowls, glasses and pieces, not just
  grams. About 9,000 foods: 1,014 Indian recipes, 542 raw ingredients with names in 15+ Indian
  languages, everyday staples like plain cooked rice, dal, eggs and milk, 7,500+ more foods from
  USDA, and packaged foods with live barcode lookup.
- **Every nutrient, unlocked.** Calories, protein, carbs, fat and fibre, plus vitamins and minerals.
  No locked cards, no "upgrade to see this".
- **Snap your plate.** Photograph a meal and get the foods and portions to confirm. Bring your own
  vision model: Claude, OpenAI, Gemini, or a free local model. You pay the provider directly at
  cost, or nothing at all.
- **Intermittent fasting.** Daily schedules or a simple timer, metabolic stages, streaks, history
  and calendar reminders.
- **Water, weight, workout, steps and sleep.** Tap to add a glass, log weigh-ins against a healthy
  range for Indian adults, pick from 35 activities (yoga, cricket, brisk walking…) for calorie
  estimates, enter your steps for distance and calories, and log your nights. Charts for each.
- **Health logs.** Blood glucose (mg/dL or mmol/L, tagged to meals), medicines with a daily
  checklist and calendar reminders, heart rate and breathing rate. Opt-in, and never a diagnosis.
- **No ads, no tracking, no account.** Your diary lives on your device, in a real SQLite database
  inside the browser. Nothing is sold, shared or "personalized". Back it up to a file whenever you like.
- **Installs like an app.** Add it to your phone's home screen and it works fully offline.

fit&health is an independent open-source project. It is not affiliated with or endorsed by any
commercial nutrition app, and it ships none of their code or data. Nutrition values come from public
datasets and are estimates; this is not medical advice.

## Two ways to run it

**1. The website (local-first, the default).** A static site: the whole API runs in your browser, in
a Web Worker on [SQLite WebAssembly](https://sqlite.org/wasm) stored in the browser's private file
system (OPFS). On first visit it downloads about 2 MB of public food data straight from the
datasets' own public copies and builds the food database on the device. Nothing else leaves the
device except barcode lookups (Open Food Facts) and Snap photos, which go directly to the vision
provider whose key you entered. It's plain static files, so any static host can serve it.

Data lives in one browser on one device. Use **Me → Your data → Back up** for a file you can
**Restore** on another phone or browser. Backups leave out your Snap AI key. The app also keeps
**automatic backups** on the device (IndexedDB, separate from the database file): one a day, plus
one before app updates and restores, keeping the last 7. If the diary ever opens empty while a
backup exists, the app offers to bring it back. They don't help if the site's data is cleared or
the phone is lost, so download a backup now and then too. Installing the app to
the home screen also stops the browser from clearing its storage when space runs low.

**2. Self-hosted server.** The same API on Node.js with `node:sqlite`, for a home server or a
family that wants one shared diary. Needs Node.js 24+. See [Food database](#food-database) and
[Running the server](#running-the-server).

## Food database

On the website, the food database is built in the browser on first visit (INDB + IFCT 2017;
packaged foods come from live barcode lookups). For the self-hosted server, the repository ships
**code only**. Every install downloads its own copy of the open datasets into `data/raw/`
(gitignored), then builds the local database.

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
| [USDA FoodData Central](https://fdc.nal.usda.gov/), SR Legacy | 50 everyday staples with Indian names and katori/glass measures (cooked rice, plain dal, eggs, milk, curd, fruit…), plus 7,500+ more foods | U.S. government work, public domain; bundled in the repo (`data/seeds/staples.json`, `apps/web/public/data/usda-sr-legacy.json.gz`) |

Data notes:
- **Deep-fried INDB recipes are flagged** (`data_quality = 'suspect_frying_oil'`, 123 foods). INDB
  counts all frying oil as eaten, so these read 600–800 kcal/100 g. They rank lower in search and
  the app shows a warning.
- Open Food Facts rows are dropped when calories disagree badly with 4·P + 4·C + 9·F.
- OFF throttles bulk reads hard (about 6 product reads a minute in practice). `data:fetch -- off`
  resumes from `data/raw/off/cache.jsonl`, and `data:build` uses whatever is cached so far.
- Household weights we authored ourselves (`data/seeds/`) are marked `is_estimated`.
- Staples rank first in search ("cooked rice" → plain cooked rice), the Indian datasets next, then
  the rest of USDA. Regenerate the USDA files with `python data/ingest/usda/convert.py <sr-legacy-csv.zip>`.

## Running the server

```sh
npm run build:server   # build the PWA for server mode into apps/web/dist
npm start              # http://localhost:8787 serves the API and the app
```

Install it from the browser menu ("Add to Home screen") on a phone on the same network.
Copy `.env.example` to `.env` to change the port or database location.

## Snap (photo meal logging)

Photograph a plate → a vision model lists each food with a household portion and a box on the photo
→ each item is matched to the food database → you tick, fix portions or swap foods → one tap logs
them to the diary (with the photo as a thumbnail).

Choose the model in **Me → Snap AI**: Claude, OpenAI, Gemini, any OpenAI-compatible server, or a
demo that needs no key. On the website, the key is stored only on your device and photos go straight
from the browser to that provider. On a self-hosted server it is stored in the server database, or
you can set it in `.env` instead (see `.env.example`):

| `VISION_PROVIDER` | Needs | Notes |
|---|---|---|
| `anthropic` | `VISION_API_KEY` (or `ANTHROPIC_API_KEY`) | Official SDK, default model `claude-opus-5-5`, structured output, server-side refusal fallback. `VISION_EFFORT` optional (default `medium`). |
| `openai` | `VISION_API_KEY`, `VISION_MODEL` | Chat Completions with a strict JSON schema. |
| `gemini` | `VISION_API_KEY`, `VISION_MODEL` | `generateContent` in JSON mode. |
| `openai_compatible` | `VISION_BASE_URL`, `VISION_MODEL` | Local models via Ollama, vLLM, LM Studio… |
| `mock` | nothing | Same sample thali for every photo; `npm run dev:api:mock` uses it. |

Photos are resized in the browser (≈1280 px JPEG) and stored in the app database. Each Snap
sends one image to the provider you configured, and that provider's pricing and data policy apply.
On Android Chrome, the Snap tab can also scan barcodes with the camera.

## Fasting tracker

- **Daily schedule** (e.g. 16:8 from 8 PM): fasts are tracked automatically; start or end any day's
  fast early, or edit it afterwards. Windows are anchored to your time zone, even if the server runs in UTC.
- **Start & stop**: a plain timer for irregular fasts.
- Presets 12:12 → OMAD, stages from 0 h to 48 h+, streaks (consecutive days with a goal-met fast),
  7-day chart and history.
- Reminders: the plan sheet offers an `.ics` calendar file with a daily alert 30 min before each fast
  and one when it ends. A web app can't send notifications while it's closed without a push server.
- Stage descriptions are general information, not medical advice.

## Trackers

- **Water:** one-tap glasses; the default goal is about 35 ml per kg of body weight (1.5–4 L).
- **Weight:** one weigh-in per day, trend chart, BMI and a healthy range of BMI 18.5–22.9 (the
  cut-offs used for Asian Indian adults). Logging a weight keeps the goal profile's weight current.
- **Workout:** calories = MET × weight × hours, with MET values from the Compendium of Physical
  Activities (2011). Only the part above resting (MET − 1) is added to the food budget, and only if
  you switch that on. Calories from a watch can be typed in instead.
- **Steps:** typed in (a website can't read the phone's step counter). Distance uses step length
  ≈ 41% of height; calories treat the steps as walking at ~5 km/h. Default goal 8,000.
- **Sleep:** bedtime and wake-up for the night ending on a date; 7–9 h is the adult guideline.

Health logs (off by default; switch them on under Diary → Track more):

- **Blood glucose:** stored in mg/dL, shown in either unit. Readings are compared with the usual
  ranges for adults without diabetes (ADA: fasting < 100, 2 h after eating < 140 mg/dL, low < 70).
  People with diabetes usually have their own targets.
- **Medicines:** times, weekdays, start and end dates, or "as needed". There's a daily Taken/Skip
  checklist with undo, an adherence chart, and an `.ics` file that puts reminders in the phone's
  calendar, so they ring even when the app is closed.
- **Heart rate and breathing rate:** manual readings with context; resting readings are compared
  with 60–100 bpm and 12–20 breaths a minute.

## Development

```sh
npm run dev:web          # Vite on :5173, local-first (API in the browser)
npm run dev:api          # server API on :8787, restarts on change
npm run dev:web:server   # Vite on :5173 in server mode, proxies /api to :8787 (set API_PORT to change)
npm test            # node:test suites (API, search, ingest, shared)
npm run typecheck   # server + web
npm run db:migrate  # apply schema migrations to var/app.db
python apps/web/scripts/make-icons.py   # re-render the PNG app icons (needs Pillow)
```

Layout: `apps/server` (Hono API + SQLite, runtime-neutral so it also runs in the browser),
`apps/web` (React PWA; `src/local/` hosts the API in a Web Worker), `packages/shared`
(nutrient registry, meal types, goal calculator, API types), `data/ingest` (fetch/build pipeline),
`data/seeds` (our own units, densities, synonyms).

## Licence

The fit&health code is released under the [MIT licence](LICENSE).

The food datasets are not part of this repository or the website and are not covered by them. The
website's first-run setup and `npm run data:fetch` download them onto your own device, where each
keeps its own terms (see the table under
[Food database](#food-database)): INDB (open access), IFCT 2017 (© ICMR-NIN; the machine-readable
packaging is AGPL-3.0) and Open Food Facts (ODbL). If you redistribute a built database, follow
those terms.
