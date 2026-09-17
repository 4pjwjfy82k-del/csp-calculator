const https = require('https');
const BASE = 'api.polygon.io';

function get(path) {
  return new Promise((resolve, reject) => {
    const key = process.env.MASSIVE_API_KEY;
    const sep = path.includes('?') ? '&' : '?';
    const url = `https://${BASE}${path}${sep}apiKey=${key}`;
    https.get(url, { headers: { 'User-Agent': 'CSP-Calculator/2.0' } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('Parse: ' + body.slice(0,200))); }
      });
    }).on('error', reject);
  });
}

exports.handler = async event => {
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  const q = event.queryStringParameters || {};
  const sym = (q.symbol || '').toUpperCase().replace(/[^A-Z0-9.]/g, '');
  if (!sym) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'symbol required' }) };

  try {
    // ── 1. Stock price (prev close — free tier) ─────────────────────
    const pr = await get(`/v2/aggs/ticker/${sym}/prev`);
    if (!pr.data.results || !pr.data.results.length)
      throw new Error(`No price data for ${sym}`);
    const price = pr.data.results[0].c;

    // ── 2. Options expirations (free tier) ──────────────────────────
    const refr = await get(`/v3/reference/options/contracts?underlying_ticker=${sym}&contract_type=put&order=asc&limit=250&sort=expiration_date`);
    const contracts = refr.data.results || [];
    if (!contracts.length) throw new Error(`No options found for ${sym}`);
    const expirations = [...new Set(contracts.map(c => c.expiration_date))].sort();

    // ── 3. Nearest expiration to DTE ────────────────────────────────
    const dte = Math.max(1, parseInt(q.dte) || 7);
    const now = new Date();
    const targetMs = now.getTime() + dte * 86400000;
    const bestExp = expirations.reduce((a, b) =>
      Math.abs(new Date(b) - targetMs) < Math.abs(new Date(a) - targetMs) ? b : a
    );
    const actualDTE = Math.max(1, Math.round((new Date(bestExp) - now) / 86400000));

    // ── 4. Strike nearest to OTM% (from reference contracts) ────────
    const otm = parseFloat(q.otm) || 2.5;
    const targetStrike = price * (1 - otm / 100);
    const expContracts = contracts.filter(c => c.expiration_date === bestExp);
    const best = expContracts.reduce((a, b) =>
      Math.abs(b.strike_price - targetStrike) < Math.abs(a.strike_price - targetStrike) ? b : a
    );

    // ── 5. VIX prev close ───────────────────────────────────────────
    let vix = null;
    try {
      const vr = await get('/v2/aggs/ticker/I:VIX/prev');
      vix = vr.data.results && vr.data.results[0] && vr.data.results[0].c;
    } catch(ve) { /* optional */ }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({
        price,
        strike: best.strike_price,
        expDate: bestExp,
        actualDTE,
        vix,
        symbol: sym
        // Note: premium (mid) not included — requires paid tier
      })
    };

  } catch(e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
