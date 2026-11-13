# TrendLab

> ** vietnam education app trend research (android & iOS).**  
> reference: [karpathy.ai/jobs](https://karpathy.ai/jobs/).

---

## Data-first workflow (new collection pipeline)

The repository is a **research prototype**, not a verified census of Vietnamese Education storefronts. AppGoblin
is a discovery catalog; a row in its dump is **not** a live install measurement.
No source currently guarantees unlimited, real-time access to all Education apps.

1. Download `live_store_apps.tsv.xz` from
   [AppGoblin Free App Datasets](https://appgoblin.info/free-app-datasets)
   or its [public dataset repository](https://github.com/appgoblin-dev/appgoblin-data),
   where available. Check licensing and attribution (CC BY 4.0).
   Do not commit large vendor datasets to the repository.
2. Import locally (Node 22+, `xz` installed for compressed TSV):

   ```bash
   npm ci
   node bin/cli.js import-catalog --file /path/to/live_store_apps.tsv.xz
   node bin/cli.js coverage
   node bin/cli.js collect --android-limit 20 --ios-limit 25 --storefront vn
   node bin/cli.js coverage
   npm test
   ```

   An uncompressed `.tsv` also works. Use `--max 1000` for a small dry run.
   The importer uses exact `app_category=education` from the provider's
   `store,store_id,app_name,app_category` columns, skips invalid IDs,
   and upserts without creating duplicates on repeated imports.
   Other provider category strings must be investigated separately.

3. The collector now persists `collection_state` per app and storefront.
   Re-running `collect` takes **due** apps, prioritizing unseen apps;
   success is due again after a default 24 hours, failures use backoff.
   Commands run a finite batch and exit. Run them again with an external
   task scheduler for periodic collection, within the sources' access terms.
   `coverage` reports **local** catalog counts, snapshots, recent collection,
   and the last ten collection audit jobs; it does NOT calculate the global
   denominator.

4. `node bin/cli.js sweep` performs supplemental chart discovery
   across configured storefronts/countries. Top-K charts do not establish
   full market coverage. `seed --curated` is a manually selected demo
   and is **never automatically inserted** by `collect` or `pipeline`.

5. Once multiple **real** snapshots have accumulated:

   ```bash
   node bin/cli.js analyze
   node bin/cli.js export
   node bin/cli.js serve
   ```

   The UI is a research aid only. Android install-counter semantics have
   not been verified as daily downloads. iOS rating counts are storefront-
   specific and must not be pooled into a fictional global download metric.

**Remaining limits:** Scraper availability/rate limits must be validated on
your machine. Apple Lookup is not unlimited; conservative pacing is configured.
The Vietnam storefront dataset's completeness/refresh cadence is not guaranteed by TrendLab.
The `backtest` command currently reports model-overlap diagnostics **only**;
it is not a predictive walk-forward backtest. The scoring formulas are
provisional, pending real historical validation.
