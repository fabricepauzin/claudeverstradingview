/**
 * Dashboard server: runs the paper engine on a timer and serves the UI.
 *   npm run dashboard   →   http://127.0.0.1:8787
 */
import 'dotenv/config';
import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { bitgetFeed } from './feed.js';
import { createEngine } from './engine.js';

const dir = (f) => fileURLToPath(new URL(f, import.meta.url));
const symbols = (process.env.SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT').split(',');
const engine = createEngine({ feed: bitgetFeed, symbols, statePath: dir('data/state.json'), tradesPath: dir('data/trades.csv') });

let exchangeUsdt = null;
const tick = async () => {
  await engine.cycle();
  try { exchangeUsdt = await bitgetFeed.accountUsdt(); } catch { /* keys optional */ }
};
tick();
setInterval(tick, 10_000);

http.createServer((req, res) => {
  if (req.url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ...engine.snapshot(exchangeUsdt), pid: process.pid, uptime: process.uptime() }));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(readFileSync(dir('index.html')));
}).listen(8787, '127.0.0.1', () => console.log('Dashboard on http://127.0.0.1:8787'));
