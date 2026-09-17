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
        catch(e) { reject(new Error('Parse error: ' + body.slice(0,100))); }
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
    // ── 1. Stock price ──────────────────────────────────────────────
    const pr = await get(`/v2/snapshot/locale/us/markets/stocks/tickers/${sym}`);
    const tk = pr.data.ticker;
    if (!tk) throw new Error(`No data for ${sym} — check symbol`);
    const price = (tk.lastTrade && tk.lastTrade.p) || (tk.day && tk.day.c) || (tk.prevDay && tk.prevDay.c);
    if (!price) throw new Error(`Could not get price for ${sym}`);

    // ── 2. Options expirations ──────────────────────────────────────
    const refr = await get(`/v3/reference/options/contracts?underlying_ticker=${sym}&contract_type=put&order=asc&limit=250&sort=expiration_date`);
    const contracts = (refr.data.results || []);
    const expirations = [...new Set(contracts.map(c => c.expiration_date))].sort();
    if (!expirations.length) throw new Error(`No options found for ${sym}`);

    // ── 3. Find expiration nearest to DTE ──────────────────────────
    const dte = Math.max(1, parseInt(q.dte) || 7);
    const now = new Date();
    const targetMs = now.getTime() + dte * 86400000;
    const bestExp = expirations.reduce((a, b) =>
      Math.abs(new Date(b).getTime() - targetMs) < Math.abs(new Date(a).getTime() - targetMs) ? b : a
    );
    const actualDTE = Math.max(1, Math.round((new Date(bestExp).getTime() - now.getTime()) / 86400000));

    // ── 4. Puts chain for that expiration ──────────────────────────
    const chain = await get(`/v3/snapshot/options/${sym}?expiration_date=${bestExp}&contract_type=put&limit=250&order=asc`);
    const puts = (chain.data.results || []);
    if (!puts.length) throw new Error(`No puts found for ${bestExp}`);

    // ── 5. Find strike nearest to OTM target ───────────────────────
    const otm = parseFloat(q.otm) || 2.5;
    const targetStrike = price * (1 - otm / 100);
    const best = puts.reduce((a, b) =>
      Math.abs(b.details.strike_price - targetStrike) < Math.abs(a.details.strike_price - targetStrike) ? b : a
    );

    const bid = best.last_quote ? best.last_quote.bid : (best.day ? best.day.close : 0);
    const ask = best.last_quote ? best.last_quote.ask : bid;
    const mid = best.last_quote && best.last_quote.midpoint ? best.last_quote.midpoint : (bid + ask) / 2;

    // ── 6. VIX ──────────────────────────────────────────────────────
    let vix = null;
    try {
      const vr = await get('/v2/snapshot/locale/us/markets/indices/tickers/I:VIX');
      const vt = vr.data.ticker;
      vix = (vt && vt.day && vt.day.c) || null;
    } catch(ve) { /* VIX optional */ }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'public, max-age=900' },
      body: JSON.stringify({ price, strike: best.details.strike_price, expDate: bestExp, actualDTE, bid, ask, mid, vix, symbol: sym })
    };

  } catch(e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
