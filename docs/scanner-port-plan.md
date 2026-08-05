# Scanner Port Plan — career-ops → charles

Replace charles's `scrapers/` + `filters.py` + `companies.yaml` with a Python port of
the career-ops scanning engine, backed by the existing database instead of flat files.

Two filter layers, per the requirement:

- **Ingest filters** — configured in the web UI, applied *during* a scan. Decide what
  ever reaches the database.
- **View filters** — applied to `/api/jobs` queries against what's already stored.

---

## Part 1 — What the career-ops scanner actually is

### 1.1 Two entrypoints over one engine

| | `scan.mjs` (2,198 ln) | `scan-ats-full.mjs` (700 ln) |
|---|---|---|
| Direction | company-first | keyword-first (reverse) |
| Source of companies | `portals.yml: tracked_companies` + `job_boards` | public ATS directories (GitHub dataset, 24h cache) + VC portfolios (`--seeds yc,a16z`) |
| Coverage ceiling | the curated list | none |
| Date policy | optional `max_posting_age_days` | **mandatory** `--since N` (default 3d); undated postings dropped unless `--include-undated` |
| Providers usable | all 63 | greenhouse/lever/ashby/workday only (seeds: first 3 — Workday needs a tenant\|instance\|site triple no portfolio slug can supply) |

`scan-ats-full` imports its filters *from* `scan.mjs`. Port `scan.mjs` first.

### 1.2 Provider layer

**Contract** (`providers/_types.js`):

```js
export default {
  id: 'greenhouse',                  // unique, must equal filename
  detect(entry) { /* → {url}|null */ },
  async fetch(entry, ctx) { /* → Job[] */ },
};
// Job: { title, url, company, location, description?, postedAt?, salary? }
```

**`_registry.mjs` (94 ln)**
- `loadProviders(dir)` — auto-discovers `*.mjs`, **skips `_`-prefixed**, sorts
  alphabetically so `detect()` priority is deterministic. Malformed modules, duplicate
  ids, and import errors are logged and skipped, never fatal.
- `resolveProvider(entry, providers, {skipIds})` — precedence:
  1. explicit `entry.provider` (bypasses detect)
  2. `local-parser` when `parser.command`+`script` configured
  3. each provider's `detect()` in load order, first hit wins
  A throwing `detect()` is caught and skipped, not fatal.

**`_http.mjs` (63 ln)** — `fetchWithTimeout` (AbortController, 10s default), `fetchJson`,
`fetchText`, `makeHttpCtx()`. Non-2xx throws an Error carrying `.status`, `.body`,
`.retryAfter`. `BROWSER_LIKE_USER_AGENT` exported for providers that must clear WAF bot
management (Glints firewall, Geico's Cloudflare-gated Workday tenant).

**SSRF invariants — must survive the port verbatim:**
- Per-provider host allowlists (`ALLOWED_GREENHOUSE_HOSTS`, `ALLOWED_LEVER_HOSTS`,
  `ALLOWED_ASHBY_HOSTS`, `ALLOWED_SMARTRECRUITERS_HOSTS`), asserted before *and* after
  URL derivation.
- HTTPS-only assertion.
- `redirect: 'error'` on every fetch — a server-side redirect cannot escape the allowlist.
- Reverse scan adds two more layers because slugs come from an untrusted dataset:
  `SLUG_RE = /^[A-Za-z0-9._-]+$/` gates the charset; `entryOnHost()` re-parses each
  constructed URL and drops anything not resolving to the ATS's canonical host.

**The four core providers:**

- `greenhouse.mjs` (76 ln) — `boards-api.greenhouse.io/v1/boards/{slug}/jobs`. Derives the
  API URL from a `job-boards[.eu].greenhouse.io/<slug>` careers URL. `postedAt` from
  `j.first_published`. **Does not request `?content=true`** — so no descriptions.
- `lever.mjs` (76 ln) — `api[.eu].lever.co/v0/postings/{slug}`. **The only core provider
  that ships descriptions for free** (`descriptionPlain`), which is why the content/visa
  filters have real signal only here.
- `ashby.mjs` (188 ln) — `api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`.
  30s timeout + 2 retries with exponential backoff and jitter (documented ~10s server-side
  latency floor that raced the 10s default). `parseCompensation()` annualizes via
  `INTERVAL_MULTIPLIERS` (1 HOUR→2080, 1 WEEK→52, …) with null-safe coercion and min/max
  ordering. `formatLocation()` folds `secondaryLocations[]` (region + locality + country,
  deduped, ` · `-joined) so a multi-region role isn't location-filtered on its primary label.
- `workday.mjs` (336 ln) — the hardest one, POST to `/wday/cxs/{tenant}/{site}/jobs`,
  paginated at 20/page. Contains:
  - `resolveEndpoint` — tries `api:` then `careers_url` against the tenant regex, falling
    through on non-match so a non-Workday `api:` can't shadow a valid `careers_url`.
  - `parsePostedOn` — Workday exposes only relative labels; "Posted Today"/"Yesterday"/
    "N Days Ago" parse, **"30+ Days Ago" deliberately yields no date** (unbounded).
  - `fetchPageWithRetry` — 3 retries on 429/5xx/network; honors `Retry-After` but clamps it
    (a hostile `Retry-After: 86400` must not stall the tenant).
  - `pageIsPastWindow` + `EARLY_STOP_MARGIN_MS` (2 days) — stops paginating once a page's
    oldest dated posting clears the `--since` window, with margin for the ~1-day label
    jitter some tenants exhibit.
  - `no-date-skip` — tenants that never emit `postedOn` stop after page 0 (every posting
    would be dropped as undated anyway); tagged on the array, aggregated by the caller into
    one summary line rather than thousands of log lines.
  - `DEFAULT_MAX_PAGES` 100 / `MAX_PAGES_CAP` 1500, `INTER_PAGE_DELAY_MS` 150, and a
    truncation warning that flags Workday's own bogus `total === maxPages*PAGE_SIZE` reports.

**Provider inventory (63 total, 4 internal):** Tier 1 multi-tenant ATS (22) — greenhouse,
lever, ashby, workday, bamboohr, breezy, comeet, csod, gem, jibeapply, jobvite, oraclecloud,
phenom, pinpoint, radancy, recruitee, rippling, smartrecruiters, successfactors, teamtailor,
workable, avature. Tier 2 single-employer (2) — amazon, ibm. Tier 3 aggregators (15) —
themuse, echojobs, remoteok, remotive, himalayas, weworkremotely, jobicy, jobspresso, nodesk,
workingnomads, 4dayweek, hackernews, agentic-jobs, higheredjobs, larajobs; these need **no
company list at all** and are gated *only* by the title/location filters. Tier 4 non-US
regional (23) — skip. Plus `local-parser` (shells out to a user script printing JSON).

Only **12 of 63** providers populate `description`: alibaba, arbeitnow, bamboohr, gem,
higheredjobs, ibm, jobstreet, meituan, lever, personio, oraclecloud, tencent. Everywhere else
the content/visa filters pass by construction.

### 1.3 The filter stack (`scan.mjs`, all pure & config-driven)

Applied in this exact order in the main loop:

| # | Filter | Config key | Semantics |
|---|---|---|---|
| 0 | trust enrich | `trust_filter` | scores, **never drops** |
| 1 | blacklist | `data/blacklist.md` | company-level, checked first |
| 2 | title | `title_filter` | `positive` OR-match (empty ⇒ pass), `negative` reject-on-any |
| 3 | tier | `skip_tiers` | via `classify-tier.mjs` |
| 4 | location | `location_filter` | `always_allow` → `block` → `allow` |
| 5 | posting age | `max_posting_age_days` | relative, opt-in |
| 6 | posted date | `--posted-after/--posted-before` | absolute, CLI-only |
| 7 | salary | `salary_filter` | range overlap + currency |
| 8 | content | `content_filter` | JD body, `by_title_keyword` scoping |
| 9 | visa | `visa_filter` | JD body, sponsorship vocabulary |
| 10 | URL dedup | — | `normalizeUrlForDedup` |
| 11 | company+role dedup | `company_aliases` | `companyRoleDedupKey` |
| 12 | cooldown | `config/profile.yml` | re-apply windows |

**`buildTitleFilter` + `compileKeyword`** — 2–3-char all-letter keywords compile to
word-boundary regexes (`\bcoo\b`) so "COO" stops matching "Coordinator"; multi-word phrases
and anything with non-letters (".NET", "L&D") stay fast substring matches. Defensive
normalization: non-string entries in YAML can't crash the scan.
`seniority_boost` **does not filter** — ranking only. The doc flags this as a frequent
misreading and the reason irrelevant keyword-matching roles survive.
`matchedTitleKeywords` returns the raw matched keywords, memoized via a `WeakMap` keyed on
the config array reference, to scope `content_filter.by_title_keyword`.

**`buildLocationFilter`** — order `always_allow` → `block` → `allow`. Empty/whitespace/
non-string location **passes** (never penalize missing data). `always_allow` beats `block`,
which rescues "Remote, Belgium or France" when France is blocked but your home region is
listed. **`allow: []` makes the whole thing a pure blocklist** — the doc calls this a real
trap and suggests inverting to fail-closed. `normalizeKeywordList` drops empty strings,
because `''` would match everything via `String.includes`.

**`buildContentFilter`** — empty/non-string description ⇒ pass; any `negative` ⇒ reject;
empty `positive` ⇒ pass; else ≥1 `positive`. `by_title_keyword` overrides: when any of a
job's matched title keywords has an override entry, the overrides govern (any passing is
enough) and the global pair is skipped.

**`buildVisaFilter`** — `DEFAULT_VISA_POSITIVE` (15 phrases incl. h-1b/h1b/h-1b1/o-1) and
`DEFAULT_VISA_NEGATIVE` (13 refusal phrasings). `require_mention: false` (default) only weeds
out explicit refusals and passes descriptionless jobs; `true` keeps only advertised
sponsorship and rejects missing descriptions.

**`buildSalaryFilter`** — annual figures; `max: 0` = no ceiling; no salary data ⇒ pass;
currency mismatch rejects only when *both* are known; range-overlap logic (reject only if the
job is entirely below min or entirely above max). Malformed bounds disable the filter with a
warning rather than mis-filtering.

**`buildPostingAgeFilter` / `buildPostedDateFilter`** — both pass undated jobs. `now` is
injectable for deterministic tests. `posted-before` is treated as end-of-day.

**`classify-tier.mjs` (160 ln)** — weighted-regex classifier → `intern|entry|mid|senior`.
Senior w4 (chief, vp, director, principal, staff, lead, senior, sr, head of, roman III/IV/V),
mid w3 (mid, II, l4/l5), entry w2 (entry, associate, junior, I, l1/l2), intern w1 (internship,
intern, trainee, co-op). Higher weight wins. Acronym preprocessing (`A.I.`→AI, `I.T.`→IT,
`i/o`→IO) prevents false roman-numeral hits. **Unmatched titles default to `mid`** — so
`skip_tiers: [mid]` excludes most ordinary listings, not just explicit mid-level ones.

### 1.4 Dedup

- `normalizeUrlForDedup` — strips an **allowlist** of cosmetic params
  (`DEDUP_STRIP_PARAMS`: locale/utm_*/ref/src/source/gh_src/lever-origin/lever-source),
  clears the hash, drops trailing slashes. Deliberately not "strip everything": several ATSes
  key the posting off a query param (Greenhouse's `gh_jid`), so a blanket strip would collapse
  distinct roles. Malformed URLs fall back to the raw string.
- `normalizeRoleForDedup` — strips trailing location/remote parentheticals using a curated
  ~75-entry `ROLE_LOCATION_SUFFIXES` set (+ `ROLE_REMOTE_SUFFIXES` for "Remote — Berlin"
  forms), so "SWE (Berlin)" and "SWE (NYC)" collapse. Seniority/discipline/team qualifiers are
  deliberately preserved so distinct variants don't merge.
- `buildCompanyCanonicalizer(company_aliases)` — maps aliases → canonical (Greenhouse
  "Intercom" vs brand "Fin"). Canonical names always own their identity regardless of YAML
  order; an alias claimed by two canonicals fails open to its raw label, so malformed config
  can never silently merge unrelated companies.
- `companyRoleDedupKey(company, role, canon)` → `company::role`.
- `shouldDedupScanHistoryRow` — permanent statuses (`skipped_invalid_url`,
  `skipped_blocked_host`) dedup forever; `cooldown:*` until its date; only `added` rows honor
  `scan_history.recheck_after_days`.
- `collectSeenCompanyRoles` — only `added` rows seed role keys, so a dead SF URL can't bury a
  live NY req; self-heals because expired postings record as `skipped_expired`.

### 1.5 Persistence (the part being replaced)

- `data/pipeline.md` — `- [ ] {url} | {Company} | {Role} | {Location} | {comp} | posted: | trust: | note:`
- `data/scan-history.tsv` — the dedup ledger. 11 columns: url, first_seen, portal, title,
  company, status, location, fingerprint, posted_at, trust_score, trust_flags. Columns are
  append-only for backward compat.
- `data/scan-runs.tsv` — 18 per-stage counters per run. The only observability into which
  filter stage drops what.
- `data/portal-health.tsv` — timestamp/company/status (`reachable|empty|slug_gone|network`).
  `computeConsecutiveFailures` builds streaks; `portal_health_threshold` (default 3) triggers
  a "FIX NEEDED" report. **This is exactly what charles lacks — it's why 14 of 24 configured
  greenhouse companies 404 silently.**
- `sanitizeMarkdownField` / `sanitizeTsvField` — job titles are attacker-influenced text; a
  tab or newline corrupts the ledger, and a leading `=+-@` is a spreadsheet formula-injection
  vector. **An injection boundary, not cosmetics** — and one that disappears entirely with a
  DB.

### 1.6 Non-filter analysis

- **`_trust-validator.mjs` (218 ln)** — score 0–100, flags, level (≥90 high, ≥60 medium, else
  low). Penalties: `missing_apply_url` 40, `invalid_url` 50, `suspicious_domain` 25,
  `company_domain_mismatch` 15. Suspicious-domain list is URL shorteners + `forms.gle`;
  company↔domain mismatch is skipped for the 16-entry ATS allowlist. **Never drops, only
  flags.**
- **`fingerprint-core.mjs` (146 ln)** — 64-bit SimHash over 3-token shingles (SHA-1 per
  shingle, first 8 bytes, bitwise vote) → 16 hex chars. `FINGERPRINT_MIN_TEXT` 200 chars and
  <3 tokens both yield `''` (an all-zero hash would score 1.0 against every other degenerate
  body). `similarity = 1 − hamming/64`; `CROSSLIST_THRESHOLD` 0.92 (≤5 differing bits);
  `CROSSLIST_WINDOW_DAYS` 90. `findCrossListings` skips same-company matches (those are
  re-posts, not cross-listings). Catches an agency re-post of a direct listing that URL and
  company+role dedup both miss.
- **`classifyFetchError`** (in `verify-portals.mjs`) — `network` | `slug_gone` (404/410) |
  `auth` (401/403) | `server` (5xx) | `unknown`. Drives board-health status.
- **`seeds/vc-portfolios.mjs` (393 ln)** — YC public API
  (`api.ycombinator.com/v0.1/companies`) and the a16z portfolio HTML page. `toPortalEntry`
  builds a careers URL from an explicit `ats`/`ats_id` hint, else guesses
  `job-boards.greenhouse.io/<slug>` (most common for YC), else the company website.
  `parseSeedEntries` is pure and unit-testable. Same `SLUG_RE` guard.

### 1.7 Deliberately out of scope

Agent layer (`modes/`, `.claude/`, slash commands, WebSearch levels), the plugins engine
(720 ln, no-op without third-party packages), everything CV/report/tracker-related, and
Playwright liveness (`--verify`, `check-liveness.mjs`, `liveness-core.mjs`). Cooldown /
re-apply windows depend on `data/applications.md` + `config/profile.yml`, neither of which
charles has.

---

## Part 2 — Port plan

### 2.0 Decisions

1. **Port to Python, don't vendor Node.** charles is a FastAPI service with an async
   SQLAlchemy layer; the scanner has to write to that session and be triggered from an API
   route. A Node sidecar would need IPC, a second dependency tree, and its own DB driver. The
   filters are pure functions and the providers are JSON mapping — both translate directly.
   `httpx.AsyncClient` + `asyncio.Semaphore` replaces `fetch` + `parallelEach`.
2. **Reinstate the blacklist.** `COPY_INSTRUCTIONS.md` excludes it, but "block certain jobs
   before they ever get stored" *is* the blacklist. It comes across, re-scoped from
   `blacklist.md` to a UI-editable list.
3. **Drop the sanitizers, `pipeline.md`, `scan-history.tsv`, and the flat-file ledger.** The
   DB is the ledger. This removes a whole bug class (`§1.5`).
4. **No migration of existing data.** `jobs.db` is dropped and rebuilt by `create_tables()`.
   The 1,521 existing rows are stale (last scraped Jun 24) and not worth carrying. This also
   means `Job` gets `tier` outright with no dead `seniority` column left behind.
5. **No test suite.** Verification is running the scanner and reading `ScanRun` counters.
   Accepted risk: the SSRF guards and Workday's pagination are the two places where a silent
   wrong answer is indistinguishable from a right one — both get manual verification against
   live boards during Phase 1.
6. **Dedup semantics change, deliberately.** career-ops dedups a URL forever. charles wants a
   live view of each board, so: `first_seen_at` is immutable, `last_seen_at` refreshes every
   run, and a `status` column tracks the lifecycle. Postings that vanish from a board that
   *successfully returned* get marked delisted rather than lingering forever (the current
   bug). The scan-history *statuses* still come across as `Job.status` values, which is what
   makes the table double as the dedup ledger.
7. **Keep `?content=true` on Greenhouse.** career-ops's provider omits it and therefore has no
   descriptions; charles's current scraper already requests it. Keeping it means the content
   and visa filters have real signal across the largest source — strictly better than the
   original.

### 2.1 Target module layout

```
scanner/
  http.py            ← providers/_http.mjs        timeouts, UA, status/retry-after on errors
  types.py           ← _types.js + JobPosting     Posting, PortalEntry, ScanContext
  registry.py        ← providers/_registry.mjs    discover + resolve, first-hit-wins
  entities.py        ← _html-entities.mjs
  errors.py          ← classifyFetchError
  dedup.py           ← normalizeUrlForDedup, normalizeRoleForDedup,
                       buildCompanyCanonicalizer, companyRoleDedupKey
  trust.py           ← _trust-validator.mjs
  fingerprint.py     ← fingerprint-core.mjs       SimHash + findCrossListings
  filters/
    title.py         ← compileKeyword, buildTitleFilter, matchedTitleKeywords
    location.py      ← buildLocationFilter
    content.py       ← buildContentFilter (incl. by_title_keyword)
    visa.py          ← buildVisaFilter + DEFAULT_VISA_POSITIVE/NEGATIVE
    salary.py        ← buildSalaryFilter
    dates.py         ← buildPostingAgeFilter, buildPostedDateFilter, classifyPostingDate
    tier.py          ← classify-tier.mjs
    chain.py         ← ordered application + per-stage counters; tracked & reverse profiles
  providers/
    greenhouse.py lever.py ashby.py workday.py …  (auto-discovered, `_`-prefixed skipped)
  directory.py       ← scan-ats-full.mjs          SOURCES, SLUG_RE, entry_on_host, dataset cache
  seeds.py           ← seeds/vc-portfolios.mjs    YC + a16z
  runner.py          ← scan.mjs main()            orchestration, concurrency, counters, persistence
```

**Deleted:** `scrapers/` (all of it), `filters.py`, `companies.yaml`, and their tests
(`test_ashby.py`, `test_greenhouse.py`, `test_lever.py`, `test_base.py`, `test_registry.py`,
`test_repository.py`).

### 2.2 Schema (`storage/models.py`)

**`Job`** — keep `id = sha256(url)[:16]`, add:

| Column | Purpose |
|---|---|
| `dedup_url` (unique, indexed) | `normalizeUrlForDedup` output — the real dedup key |
| `first_seen_at` / `last_seen_at` | immutable discovery date + the delisting fix |
| `status` | `active`, `delisted`, `skipped_invalid_url`, `skipped_blocked_host`, `skipped_expired` |
| `tier` | `classifyTier` → `intern\|entry\|mid\|senior` (replaces `seniority`) |
| `salary_min` / `salary_max` / `salary_currency` | Ashby `parseCompensation` |
| `trust_score` / `trust_flags` (JSON) | trust validator |
| `fingerprint` (indexed) | SimHash, for cross-listing detection |
| `provider_id` | which provider fetched it |
| `discovery` | `tracked` / `directory` / `seed` / `board` |

Indexes: `(status, posted_at DESC)`, `company`, `tier`, unique `dedup_url`, `fingerprint`.

**New tables:**
- `TrackedCompany` — `name`, `careers_url`, `api_url`, `provider` (nullable override),
  `enabled`, `max_pages`, `notes`. Replaces `companies.yaml` + `portals.yml:tracked_companies`.
- `ScanConfig` — singleton, mirroring `UserInfo`'s pattern. JSON columns per ingest filter
  (`title_filter`, `location_filter`, `content_filter`, `visa_filter`, `salary_filter`,
  `skip_tiers`, `max_posting_age_days`, `blocked_companies`, `company_aliases`) plus directory
  settings (`since_days`, `include_undated`, `ats_sources`, `limit_per_ats`, `shuffle`,
  `concurrency`).
- `ScanRun` — per-stage counters + timestamp/status/mode, plus the reverse-scan degradation
  fields from `scan-ats-full --json` (`companies_available`, `companies_scanned`, `cap_hit`,
  `dataset_status`, `dropped_no_date`, `unreachable_boards`). This is what distinguishes a
  *degraded* scan from a genuinely *empty* one.
- `BoardHealth` — timestamp/company/status + a streak query reproducing
  `computeConsecutiveFailures`.

### 2.3 Two filter layers

**Ingest (pre-store).** `ScanConfig` → filter builders → `filters/chain.py`, applied in the
`§1.3` order inside the runner, counters accumulated into `ScanRun`. Nothing that fails a
stage is written. Two chain profiles: the full 12-stage **tracked** profile, and the shorter
**reverse** profile (`classifyPostingDate` → title → location → content) that the directory
sweep uses.

**View (post-store).** `GET /api/jobs` gains `location`, `tier`, `posted_after`,
`posted_before`, `salary_min`, `trust_level`, `status`, `has_description`, and full-text `q`
over `description` — SQL `WHERE` clauses sharing vocabulary with the ingest filters.

Ingest filters are destructive, so they need a dry-run before committing:
`POST /api/scanner/preview` runs the full pipeline with `persist=False` and returns the
per-stage counter breakdown plus a sample of kept/dropped postings. This is how the filters
get tuned without repeatedly poisoning the DB.

### 2.4 API surface (`api/routers/scanner.py`, replacing `scraper.py`)

```
GET  /api/scanner/config       PUT  /api/scanner/config
GET  /api/scanner/companies    POST/PUT/DELETE /api/scanner/companies/{id}
POST /api/scanner/run          { mode: tracked|directory|seeds, since_days, limit, ats[], seeds[] }
POST /api/scanner/preview      dry-run → per-stage counters + sample
GET  /api/scanner/runs         ScanRun history
GET  /api/scanner/health       BoardHealth + failure streaks
```

Note the `--seeds`-without-`--ats` semantics from `scan-ats-full.mjs:189-193`: passing seeds
alone must not also trigger the full ATS directory walk.

### 2.5 Frontend — and the volume problem

New `/scanner` page, tabs: **Filters** (ingest config editor + live preview counts),
**Companies** (`TrackedCompany` CRUD — paste a careers URL, the resolved provider is echoed
back), **Runs** (per-stage funnel: found → title → location → … → stored), **Health** (failing
boards + streaks).

**The jobs table will not survive the directory sweep as written.** Today it uses `OFFSET`
paging with `limit=100` hardcoded, disables *Next* via the heuristic `jobs.length < 100`, and
`JobsTable` renders every row handed to it. The reverse scanner produces tens of thousands of
rows, where `OFFSET 50000` makes SQLite walk 50,000 rows to discard them.

Changes:
- **Cursor pagination** on `(posted_at DESC, id)`. `/api/jobs` returns `{items, next_cursor}`;
  constant-time at any depth. *Next* keys off `next_cursor === null`.
- **Page size 50**, render only the current page. No virtualization — with server-side
  filtering, scrolling 2,000 rows isn't the workflow, and paging is far simpler.
- **Default view filtered to `status = 'active'`** plus a recency window, so the landing page
  is never the raw firehose.
- **Capped count** — `SELECT COUNT(*) FROM (SELECT 1 FROM jobs WHERE … LIMIT 1001)` so the
  header shows "1000+" without a full scan on every keystroke.

`seniority` → `tier` is a breaking change to `JobsTable.tsx` and `FilterBar.tsx`.

### 2.6 Phases

**0 — Schema.** Models + `_MIGRATIONS` entries (the existing additive/idempotent mechanism
handles this; no Alembic). Drop `jobs.db`. Seed `TrackedCompany` from `companies.yaml` —
**this is where the 14 dead greenhouse slugs get confronted**, since entries become careers
URLs and wrong ones surface in Health instead of silently 404ing.
*Exit:* app boots, new tables exist, old scraper still runs.

**1 — Core + 4 providers.** `http`, `types`, `registry`, `dedup`, `errors` + greenhouse,
lever, ashby, workday. Port the SSRF guards and Workday's retry/early-stop/no-date-skip logic
faithfully — scar tissue, not incidental complexity. **`ScanContext` must carry `since_ms` and
`include_undated` from day one** — Workday's early-stop and no-date-skip read them, and
retrofitting in Phase 5 means every tenant grinds to `max_pages` until then.
*Exit:* `python -m scanner.probe <careers_url>` resolves a provider and prints postings.
Manual SSRF verification: untrusted host rejected, non-HTTPS rejected, redirect refused.

**2 — Filters.** All seven builders + tier classifier + `classifyPostingDate` + `chain.py`
with both profiles. Pure, no I/O. Read config from a `ScanConfig` dict, so Phase 4 only has to
supply the editor.
*Exit:* chain runs against a captured provider payload and produces sane counters.

**3 — Runner + persistence (the cutover).** `runner.py`: load config → build filters → resolve
companies → concurrent fetch behind an `asyncio.Semaphore` → chain → persist.
`persist_postings` implements the lifecycle: match on `dedup_url`; new rows get
`first_seen_at = last_seen_at = now, status = active`; existing rows refresh mutable fields
and `last_seen_at` with `first_seen_at` frozen; then postings previously active for a board
**that returned successfully this run** but absent now become `delisted`. The success
qualifier is load-bearing — a 404'd board must never delist its whole company. `ScanRun` +
`BoardHealth` writes, streak computation, `scheduler.py` rewired.
**Delete `scrapers/`, `filters.py`, `companies.yaml`** and their tests.
*Exit:* the new scanner is the only scanner.

**4 — API + UI.** `api/routers/scanner.py`, the preview endpoint, `/scanner` page, extended
`/api/jobs` with cursor pagination and view filters, `FilterBar`/`JobsTable` updated for
`tier`. **Both filter layers become configurable from the website here.**
*Exit:* ingest filters tunable with live preview counts; jobs list holds up at scale.

**5 — Directory sweep + seeds.** `directory.py` (the `SOURCES` map, dataset cache with
stale-beats-nothing fallback, `SLUG_RE`, `entry_on_host`, `sample_companies` + shuffle) and
`seeds.py` (YC + a16z, `to_portal_entry`). Default `since_days` to **7, not 3** — §9.5 says
the 3-day default surprises everyone; first run should use 30.
*Exit:* coverage ceiling removed; degradation visible in `ScanRun`.

**6 — Remaining providers.** 18 more Tier-1 multi-tenant, then amazon/ibm, then the 15
aggregators. ~4,000 lines of mechanical JSON mapping. **Aggregators land last on purpose:**
they need no company list and are gated *only* by title/location, so they arrive after Phase 4
provides the UI and preview to tune those filters.

**7 — Trust + fingerprint.** `trust.py` as Stage 0 (never drops), `fingerprint.py` writing
SimHash; `find_cross_listings` surfaces near-identical JD bodies from different companies as a
UI warning. Deferred because both are enrichment — nothing upstream depends on them.

**8 — Optional: Playwright liveness.** Already in `requirements.txt`. Excluded by
`COPY_INSTRUCTIONS.md` for harness reasons, not because it's agentic. Slow (strictly
sequential) and independent; defer until the rest is stable.

### 2.7 Where each `scan-ats-full.mjs` capability lands

It is not portable as a unit — it's a CLI wrapper over capabilities belonging at different
layers, several of which the *tracked* path needs too.

| Capability | Phase |
|---|---|
| `SOURCES` map (4 ATSes, dataset URLs, `toEntry`) | 5 |
| Workday `tenant\|instance\|site` triple parsing | 5 (provider itself: 1) |
| Dataset download + 24h cache + `ok/stale/empty` | 5 |
| `SLUG_RE` charset gate | 5 |
| `entryOnHost()` post-construction host re-check | 5 |
| `classifyPostingDate` (stale/undated/keep) | fn in 2, wired in 5 |
| `--since` / `--include-undated` | config 2, UI 4, default 5 |
| `sampleCompanies` + `--shuffle` | 5 |
| `parallelEach` / concurrency | 3 (tracked runner needs it) |
| `ctx.sinceMs` + `ctx.includeUndated` provider cooperation | **1** (lives inside `workday.py`) |
| `workdayNoDateSkip` aggregation | tag 1, counter 3 |
| `passesFilters` short chain | 2 (reverse profile) |
| `filterBlacklistedOffers` | 2/3 (shared with tracked) |
| Seeds (`SEED_SOURCES`, `runSeedScan`, `toPortalEntry`) | 5 |
| `--seeds` without `--ats` disables directory sweep | 4/5 (API param semantics) |
| `--json` degraded-vs-empty result | `ScanRun` 3, API response 4 |
| `--verbose` per-board failures | 3 (`BoardHealth` makes it queryable) |
| `--liveness` | 8 |
| `--dry-run` | 4 (preview endpoint) |
| CLI arg parsing / flag validation | dropped — API params |
| `--md-out` markdown digest | dropped |
| `pipeline.md` / `scan-history.tsv` writes | dropped — the DB |
| progress ticker | dropped — TTY affordance |

### 2.8 Risks

- **Provider long tail.** ~39 providers ≈ 4,000 lines. Phased, but it's the bulk of the
  mechanical work.
- **Workday is 336 lines of hard-won behavior.** Every constant has a documented failure
  behind it. Port faithfully.
- **Directory-sweep volume.** Thousands of companies per ATS. The `--since` gate and
  undated-drop are what make it tractable — they must exist before the sweep, not after.
- **No tests.** SSRF guards and Workday pagination fail silently when wrong; both get manual
  verification in Phase 1.
- **Descriptions are sparse** (12/63 providers). Content and visa filters are near-inert
  elsewhere; keeping Greenhouse's `content=true` is what makes them useful here.
- **`allow: []` is fail-open.** Decide explicitly whether the UI defaults to fail-closed.
- **`skip_tiers: [mid]` over-excludes**, because unmatched titles default to `mid`. Surface
  that in the UI copy.
