#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Repository = require('../src/storage/repository');
const SeedImporter = require('../src/catalog/seed_importer');
const StoreSweeper = require('../src/catalog/store_sweeper');
const CollectionScheduler = require('../src/collector/scheduler');
const DerivedMetricsCalculator = require('../src/analytics/derived_metrics');
const TrendScoringEngine = require('../src/analytics/trend_models');
const BacktestingHarness = require('../src/validation/backtesting');
const SiteDataBuilder = require('../src/export/build_site_data');

const command = process.argv[2] || 'help';

async function main() {
  const repo = new Repository();

  switch (command) {
    case 'seed': {
      console.log('--- COMMAND: SEED CATALOG ---');
      const importer = new SeedImporter(repo);
      importer.importCuratedSeeds();
      break;
    }

    case 'sweep': {
      console.log('--- COMMAND: SWEEP TOP CHARTS ---');
      const sweeper = new StoreSweeper(repo);
      await sweeper.sweepAppleEducationCharts(['us', 'vn', 'gb']);
      await sweeper.sweepGooglePlayEducationCharts();
      break;
    }

    case 'collect': {
      console.log('--- COMMAND: RUN COLLECTION ---');
      const scheduler = new CollectionScheduler(repo);
      await scheduler.runFullCycle({ androidLimit: 50, iosLimit: 50 });
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
      
      const importer = new SeedImporter(repo);
      importer.importCuratedSeeds();

      const scheduler = new CollectionScheduler(repo);
      await scheduler.runFullCycle({ androidLimit: 30, iosLimit: 40 });

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
  seed       Import curated education seed catalog
  sweep      Discover new trending apps via store top charts
  collect    Run data collection workers (Android & iOS)
  analyze    Calculate derived metrics & trend scores
  backtest   Run model tournament & walk-forward validation
  export     Export site data artifact (data.json)
  pipeline   Run complete end-to-end pipeline
  serve      Start local dashboard server
`);
  }
}

main().catch(console.error);
