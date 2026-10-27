/**
 * Real market data from Bitget public endpoints (no API key needed),
 * plus an optional read-only account balance when keys are in .env.
 */
import { createHmac } from 'crypto';

const BASE = 'https://api.bitget.com';

async function getJson(path, headers = {}) {
  const res = await fetch(BASE + path, { headers, signal: AbortSignal.timeout(8000) });
  const json = await res.json();
  if (json.code !== '00000') throw new Error(`Bitget ${json.code}: ${json.msg}`);
  return json.data;
}

export const bitgetFeed = {
  /** Closed + current 1m candles, oldest first: {t,o,h,l,c,v} */
  async candles(symbol, limit = 100) {
    const rows = await getJson(`/api/v2/spot/market/candles?symbol=${symbol}&granularity=1min&limit=${limit}`);
    return rows
      .map((r) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
      .sort((a, b) => a.t - b.t);
  },

  async ticker(symbol) {
    const [d] = await getJson(`/api/v2/spot/market/tickers?symbol=${symbol}`);
    return { last: +d.lastPr, bid: +d.bidPr, ask: +d.askPr };
  },

  /** Read-only USDT balance of the real exchange account, or null if no keys. */
  async accountUsdt() {
    const { BITGET_API_KEY: key, BITGET_SECRET_KEY: secret, BITGET_PASSPHRASE: pass } = process.env;
    if (!key || !secret || !pass) return null;
    const path = '/api/v2/spot/account/assets?coin=USDT';
    const ts = Date.now().toString();
    const sign = createHmac('sha256', secret).update(ts + 'GET' + path).digest('base64');
    const data = await getJson(path, {
      'ACCESS-KEY': key, 'ACCESS-SIGN': sign, 'ACCESS-TIMESTAMP': ts, 'ACCESS-PASSPHRASE': pass,
    });
    return data[0] ? +data[0].available : 0;
  },
};
