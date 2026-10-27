import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createEngine } from '../dashboard/engine.js';
import { rsi, consensus } from '../dashboard/agents.js';

// Synthetic feed: TEST ONLY (production uses dashboard/feed.js with live Bitget data).
function fakeFeed(drift) {
  let px = 100, t = 0;
  const bars = [];
  return {
    async candles() {
      for (let i = 0; i < 100 && bars.length < 100; i++) bars.push(mk());
      bars.push(mk()); bars.shift();
      return [...bars];
    },
    async ticker() { return { last: px, bid: px * 0.9999, ask: px * 1.0001 }; },
  };
  function mk() {
    const o = px; px *= 1 + drift + Math.sin(t++ / 4) * 0.0015;
    return { t, o, h: Math.max(o, px) * 1.0003, l: Math.min(o, px) * 0.9997, c: px, v: 10 + (t % 7) * 4 };
  }
}

test('rsi is 100 on a pure uptrend', () => {
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i + 1)), 100);
});

test('consensus: a veto blocks entry', () => {
  const r = [{ agent: 'A', vote: 1 }, { agent: 'B', vote: 1 }, { agent: 'C', vote: 1 }, { agent: 'Z', vote: 0, veto: true }];
  assert.equal(consensus(r).enter, false);
});

test('engine keeps accounting consistent and pays fees', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'dash-')), 'state.json');
  const engine = createEngine({ feed: fakeFeed(0.0001), symbols: ['TESTUSDT'], statePath });
  for (let i = 0; i < 60; i++) await engine.cycle();
  const s = engine.snapshot();
  assert.equal(s.cycle, 60);
  assert.ok(s.feesPaid > 0, 'fees must be charged on every fill');
  assert.ok(s.balance > 0 && Number.isFinite(s.pnl));
  assert.equal(s.wins + s.losses, s.trades);
});
