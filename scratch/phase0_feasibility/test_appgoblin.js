const https = require('https');

function checkUrl(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      resolve({
        url,
        statusCode: res.statusCode,
        headers: res.headers
      });
    });
    req.on('error', (err) => resolve({ url, error: err.message }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ url, error: 'Timeout' });
    });
  });
}

async function testAppGoblin() {
  console.log('=== EXPERIMENT: APPGOBLIN API & DATASETS ===\n');
  
  const testEndpoints = [
    'https://appgoblin.info/api/v1/apps/com.spotify.music',
    'https://appgoblin.info/',
    'https://raw.githubusercontent.com/appgoblin-dev/adscrawler/main/README.md',
    'https://api.github.com/repos/appgoblin-dev/appgoblin/releases'
  ];

  for (const ep of testEndpoints) {
    const res = await checkUrl(ep);
    console.log(`Endpoint: ${ep}`);
    console.log(`  Status: ${res.statusCode || 'N/A'}`);
    if (res.error) console.log(`  Error: ${res.error}`);
    if (res.headers && res.headers['content-type']) {
      console.log(`  Content-Type: ${res.headers['content-type']}`);
    }
    if (res.headers && res.headers['content-length']) {
      console.log(`  Content-Length: ${res.headers['content-length']} bytes`);
    }
    console.log('');
  }
}

testAppGoblin();
