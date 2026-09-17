const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

exports.handler = async event => {
  const q = event.queryStringParameters || {};
  const raw = (q.symbol || '').toUpperCase().replace(/[^A-Z0-9.^-]/g,'');
  const sym = encodeURIComponent(raw);
  if (!sym) return { statusCode: 400, body: JSON.stringify({ error: 'symbol required' }) };

  const url = q.type === 'chart'
    ? `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`
    : `https://query1.finance.yahoo.com/v7/finance/options/${sym}${q.date ? '?date=' + q.date : ''}`;

  try {
    const r = await get(url);
    return {
      statusCode: r.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900'
      },
      body: r.body
    };
  } catch(e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
