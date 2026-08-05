# Sources Refactor Plan

Turn "where jobs come from" into a first-class, extensible concept. Today there are three
hardcoded discovery modes plus twelve job boards misfiled as providers. After this there
is one registry of **sources**, each with its own enable state, settings, run history and
UI panel.

---

## 1. The distinction being formalized

**Provider** knows how to read one ATS API. Greenhouse, Lever, Ashby, Workday, and the
other tenant-based ATSes. Meaningless without a company to name.

**Source** knows where postings come from in the first place. It may feed companies to
providers, or it may return postings directly with no provider involved at all.

That second half is why this refactor matters. Every future source on the roadmap
(a GitHub list, a newsletter, someone posting roles on social media) produces postings
directly and has no board and no provider. The current design has nowhere to put them.

---

## 2. The source contract

```python
class Source(Protocol):
    id: str            # unique, matches the filename
    label: str         # shown in the Sources tab
    profile: str       # "tracked" | "reverse" — which filter chain profile

    async def scan(self, sctx: SourceContext) -> None: ...
```

```python
@dataclass
class SourceContext:
    config: dict                      # the global ScanConfig (ingest filters)
    settings: dict                    # this source's own settings blob
    http: ScanContext                 # shared HTTP client
    keep: Callable[[Posting], bool]   # runner-owned: filters, dedups, accumulates
    result: ScanResult                # source writes its own metadata here
```

### Why `keep()` is a callback and not a return value

**Filtering never happens inside a source.** A source calls `sctx.keep(posting)` for every
posting it finds. `keep()` runs the shared filter chain, ticks the per-stage counters,
applies dedup, and stores the survivor. The source has no say in what is kept.

Two reasons this matters more than it looks:

1. **The funnel stays one honest number.** If each source filtered itself, the Runs tab
   counters would fragment and each new source could silently drift in semantics. That is
   precisely how the old `filters.py` became untrustworthy.
2. **Memory stays bounded.** A full Greenhouse directory sweep is 8,333 boards. Returning
   a list would mean holding several hundred thousand postings in memory before filtering.
   With a callback, postings are filtered and discarded as they stream in.

A source still *receives* the config, because Workday reads `since_days` to stop
paginating early. That is deciding how much to fetch, not what to keep. Fetch-less is a
source's call. Keep-less is not.

### What a source still owns

- Its own concurrency and pagination
- Which chain profile it wants (`tracked` = full chain, `reverse` = short chain with the
  mandatory freshness gate)
- Its own metadata on `result`: `companies_scanned`, `companies_available`, `cap_hit`,
  `dataset_status`, `health` records, `errors`

---

## 3. The fifteen sources

| id | label | profile | feeds providers |
|---|---|---|---|
| `tracked` | My companies | tracked | yes |
| `directory` | ATS directories | reverse | yes |
| `seeds` | YC and A16Z direct ATS Greenhouse/Ashby/Lever | reverse | yes |
| `remotive` | Remotive | reverse | no |
| `remoteok` | RemoteOK | reverse | no |
| `jobicy` | Jobicy | reverse | no |
| `himalayas` | Himalayas | reverse | no |
| `workingnomads` | Working Nomads | reverse | no |
| `themuse` | The Muse | reverse | no |
| `weworkremotely` | We Work Remotely | reverse | no |
| `jobspresso` | Jobspresso | reverse | no |
| `nodesk` | NoDesk | reverse | no |
| `larajobs` | LaraJobs | reverse | no |
| `higheredjobs` | HigherEdJobs | reverse | no |
| `4dayweek` | 4 Day Week | reverse | no |

The twelve board sources move out of `scanner/providers/` unchanged in substance. Their
`detect()` returning `None` was a workaround for being in the wrong pile and simply goes
away.

Three aggregators from the original extraction stay unbuilt: `echojobs`, `hackernews`
(needs Algolia thread-comment parsing), `agentic-jobs`.

---

## 4. Target layout

```
scanner/
  sources/
    __init__.py
    _registry.py       # discover scanner/sources/*.py, skip _-prefixed
    _ats.py            # shared: run a list of PortalEntry through providers
    _board.py          # shared: single-feed board sources (the twelve)
    tracked.py         # reads tracked_companies
    directory.py       # moved from scanner/directory.py
    seeds.py           # moved from scanner/seeds.py
    remotive.py  remoteok.py  jobicy.py  himalayas.py  workingnomads.py
    themuse.py   weworkremotely.py  jobspresso.py  nodesk.py
    larajobs.py  higheredjobs.py    fourdayweek.py
  providers/           # unchanged, minus the twelve board modules
  runner.py            # owns keep(), counters, persistence; no per-mode functions
```

`run_tracked_scan` / `run_directory_scan` / `run_seed_scan` collapse into one
`run_source(source, config)`.

---

## 5. Schema

| Change | Note |
|---|---|
| `Job.discovery` → `Job.source_id` (String 64) | backfill `UPDATE jobs SET source_id = discovery` |
| `ScanRun.mode` → `ScanRun.source_id` | same idea, one run row per source per execution |
| new `SourceConfig` table | `id`, `enabled`, `settings` (JSON), `updated_at` |
| `ScanConfig` loses `ats_sources`, `limit_per_ats`, `shuffle` | these move into the directory source's `settings` |

`SourceConfig` rows are created lazily the first time a registered source is seen, so
dropping in a new source file needs no migration.

`since_days` and `include_undated` **stay global** on `ScanConfig`, because every
`reverse`-profile source uses them and duplicating them into thirteen settings blobs would
guarantee they drift apart.

### Run semantics

One `ScanRun` row **per source**, not per execution. Running all enabled sources produces
thirteen rows rather than one blended row. That is the whole point of separate sources, and
it means the Runs tab shows that RemoteOK contributed 4 and Himalayas contributed 60
instead of one meaningless total.

---

## 6. API

```
GET  /api/scanner/sources           id, label, enabled, settings, last run summary
PUT  /api/scanner/sources/{id}      enable/disable + settings
POST /api/scanner/run               { source_id } | { all: true }
POST /api/scanner/preview           { source_id, overrides }
```

`/api/scanner/companies` stays exactly as-is. It becomes the settings API for the
`tracked` source rather than a top-level concept.

---

## 7. Frontend

Tabs become **Filters | Sources | Runs | Health**. The Companies tab disappears as a tab
and returns as the `tracked` source's panel.

The Sources tab is a list of fifteen rows. Each row has an enable toggle, a "Scan now"
button, and a one-line last-run summary. Expanding a row reveals its panel.

Panels are hand written per source, keyed by source id, per your call. A shared default
panel (just the toggle plus last-run info) covers the twelve board sources so they do not
each need a file that says nothing. The three that matter get real panels:

- **My companies** — the existing companies table, moved
- **ATS directories** — which ATS directories, company cap, shuffle
- **YC and A16Z direct ATS** — which lists (YC, a16z)

---

## 8. Phases

1. **Contract + registry.** `Source` protocol, `SourceContext`, `_registry.py`, and
   `run_source()` in the runner. Move the existing three modes into `sources/` behind the
   new interface. Nothing user-visible changes.
2. **Move the twelve.** Out of `providers/`, into `sources/` on the `_board.py` helper.
   Delete the dead `detect()` stubs.
3. **Schema + settings.** `SourceConfig` table, the two column renames with backfill,
   per-source `ScanRun` rows.
4. **API.** The four endpoints above.
5. **Frontend.** Sources tab, three real panels, one default panel.

---

## 9. Open items

**Cross-run duplicate jobs.** Turning on board sources will surface the same role twice,
once from a company's own board and once syndicated to an aggregator. URL dedup misses it
(different URLs) and company+role dedup only runs within a single scan. The SimHash
fingerprint already stored on every posting was built exactly for this but currently only
warns. Promoting it to a real dedup is a separate piece of work and should probably land
before the board sources are enabled by default.

**"Run all" ordering.** The twelve board sources are one HTTP request each and finish in
seconds. A directory sweep is thousands of requests. Running them together means the fast
results are invisible until the slow one finishes. Suggest running sources sequentially
but writing each `ScanRun` as it completes, so the Runs tab fills in progressively.

**Board sources and the freshness gate.** They are marked `reverse`, which drops undated
postings by default. Several of these feeds do return dates, but if any do not, they will
silently contribute nothing until `include_undated` is set. Worth checking per feed during
phase 2.
