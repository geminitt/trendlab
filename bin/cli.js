#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Repository = require('../src/storage/repository');
const SeedImporter = require('../src/catalog/seed_importer');
const BulkCatalogImporter = require('../src/catalog/bulk_importer');
const StoreSweeper = require('../src/catalog/store_sweeper');
const CollectionScheduler = require('../src/collector/scheduler');
const DerivedMetricsCalculator = require('../src/analytics/derived_metrics');
const TrendScoringEngine = require('../src/analytics/trend_models');
const BacktestingHarness = require('../src/validation/backtesting');
const SiteDataBuilder = require('../src/export/build_site_data');

const command = process.argv[2] || 'help';

function flag(name, fallback = null) {
  const args = process.argv.slice(3);
  const at = args.indexOf('--' + name);
  if (at === -1) return fallback;
  if (at + 1 >= args.length || args[at + 1].startsWith('--')) {
    throw new Error('--' + name + ' requires a value');
  }
  return args[at + 1];
}
function positiveIntFlag(name, fallback) {
  const value = Number(flag(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('--' + name + ' must be a positive integer');
  return value;
}

async function main() {
  const repo = new Repository();

  switch (command) {
    case 'seed': {
      console.log('--- COMMAND: SEED CATALOG ---');
      const importer = new SeedImporter(repo);
      if (!process.argv.includes('--curated')) {
        throw new Error('Curated seeds are opt-in. Use seed --curated or import-catalog --file PATH');
      }
      importer.importCuratedSeeds();
      break;
    }

    case 'import-catalog': {
      const input = flag('file');
      if (!input) throw new Error('Usage: import-catalog --file PATH [--max N]');
      const importer = new BulkCatalogImporter(repo);
      const maxApps = flag('max') === null ? Infinity : positiveIntFlag('max', 1000);
      const report = await importer.importFile(input, { maxApps });
      console.log(JSON.stringify(report, null, 2));
      break;
    }

    case 'coverage': {
      console.log(JSON.stringify(repo.getCoverageReport(), null, 2));
      break;
    }

    case 'sweep': {
      console.log('--- COMMAND: SWEEP TOP CHARTS ---');
      const sweeper = new StoreSweeper(repo);
      await sweeper.sweepAppleEducationCharts(flag('storefronts')
        ? flag('storefronts').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
        : require('../config/default.json').catalog.surveyedStorefronts);
      await sweeper.sweepGooglePlayEducationCharts();
      break;
    }

    case 'collect': {
      console.log('--- COMMAND: RUN COLLECTION ---');
      const scheduler = new CollectionScheduler(repo);
      await scheduler.runFullCycle({
        androidLimit: positiveIntFlag('android-limit', 200),
        iosLimit: positiveIntFlag('ios-limit', 200),
        storefront: flag('storefront', 'us')
      });
      break;
    }

    case 'analyze': {
      console.log('--- COMMAND: RUN ANALYTICS & TREND MODELS ---');
      const calculator = new DerivedMetricsCalculator(repo);
      calculator.calculateAll();
      const scoring = new TrendScoringEngine(repo);
      scoring.evaluateAllWindows();
      break;
    }

    case 'backtest': {
      console.log('--- COMMAND: RUN BACKTESTING ---');
      const harness = new BacktestingHarness(repo);
      harness.runWalkForwardValidation({ k: 10 });
      break;
    }

    case 'export': {
      console.log('--- COMMAND: BUILD DATA ARTIFACTS ---');
      const builder = new SiteDataBuilder(repo);
      builder.build();
      break;
    }

    case 'pipeline': {
      console.log('====================================================');
      console.log('   TRENDLAB: FULL END-TO-END RESEARCH PIPELINE      ');
      console.log('====================================================');
      
      const scheduler = new CollectionScheduler(repo);
      await scheduler.runFullCycle({
        androidLimit: positiveIntFlag('android-limit', 200),
        iosLimit: positiveIntFlag('ios-limit', 200),
        storefront: flag('storefront', 'us')
      });

      const calculator = new DerivedMetricsCalculator(repo);
      calculator.calculateAll();

      const scoring = new TrendScoringEngine(repo);
      scoring.evaluateAllWindows();

      const harness = new BacktestingHarness(repo);
      harness.runWalkForwardValidation({ k: 10 });

      const builder = new SiteDataBuilder(repo);
      builder.build();

      console.log('\nPipeline completed successfully! Run "node bin/cli.js serve" to explore dashboard.');
      break;
    }

    case 'serve': {
      const port = process.env.PORT || 8080;
      const webDir = path.resolve(__dirname, '../web');

      const server = http.createServer((req, res) => {
        let reqPath = req.url.split('?')[0];
        if (reqPath === '/') reqPath = '/index.html';
        const filePath = path.join(webDir, reqPath);

        const mimeTypes = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml'
        };

        const ext = path.extname(filePath);
        const contentType = mimeTypes[ext] || 'text/plain';

        fs.readFile(filePath, (err, content) => {
          if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
          }
        });
      });

      server.listen(port, () => {
        console.log(`TrendLab Research Dashboard running at: http://localhost:${port}/`);
      });
      break;
    }

    default:
      console.log(`
Usage: node bin/cli.js <command>

Commands:
  import-catalog --file PATH [--max N]   Import AppGoblin TSV / TSV.XZ catalog
  coverage                          Report local catalog coverage and freshness
  seed --curated                    Optional small curated demo catalog (not market coverage)
  sweep [--storefronts us,gb,jp]      Discover via charts (Top-K only)
  collect [--android-limit 200 --ios-limit 200 --storefront us]  Run due-app collection
  analyze    Calculate derived metrics & trend scores
  backtest   Run model tournament & walk-forward validation
  export     Export site data artifact (data.json)
  pipeline   Run due-app collection, analysis and export (no demo seeds)
  serve      Start local dashboard server
`);
  }
}

main().catch(console.error);
