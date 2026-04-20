/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Logo from './assets/logo.png';
import { useTradingEngine } from './services/tradingEngine';
import { cn, formatCurrency } from './lib/utils';
import { getMarketRecommendations } from './services/aiService';
import { fetchPythonMarketStats, PythonMarketStats } from './services/dataService';
import { TradingChart, OHLCCandle } from './components/TradingChart';
import { OrderTicket } from './components/OrderTicket';
import { NewsPanel } from './components/NewsPanel';
import { Play, Pause, Plus, Clock } from 'lucide-react';

const BASE_PRICES: Record<string, number> = {
  // Crypto (Binance live — these are fallback seeds only)
  BTC: 75000, ETH: 1580, SOL: 130, BNB: 590, XRP: 2.15, ADA: 0.62,
  // Stocks (Twelve Data live — these are fallback seeds only)
  AAPL: 198, TSLA: 247, NVDA: 875, MSFT: 378, AMZN: 182, GOOGL: 156, META: 498,
  // Commodities — updated to real April 2026 prices
  XAUUSD: 4792, XAGUSD: 32.5, USOIL: 62.4, NATGAS: 3.2, COPPER: 4.8,
};

const CATEGORY_MAP: Record<string, 'crypto' | 'stocks' | 'commodities'> = {
  BTC: 'crypto', ETH: 'crypto', SOL: 'crypto', BNB: 'crypto', XRP: 'crypto', ADA: 'crypto',
  AAPL: 'stocks', TSLA: 'stocks', NVDA: 'stocks', MSFT: 'stocks', AMZN: 'stocks', GOOGL: 'stocks', META: 'stocks',
  XAUUSD: 'commodities', XAGUSD: 'commodities', USOIL: 'commodities', NATGAS: 'commodities', COPPER: 'commodities',
};

type MWCategory = 'all' | 'crypto' | 'stocks' | 'commodities';
const MW_CATEGORIES: { key: MWCategory; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: '◈' },
  { key: 'crypto', label: 'Crypto', icon: '₿' },
  { key: 'stocks', label: 'Stocks', icon: '📈' },
  { key: 'commodities', label: 'Commod.', icon: '⛏' },
];
const TIMEFRAMES: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

function genHistory(symbol: string, tf: number, count = 200): OHLCCandle[] {
  const base = BASE_PRICES[symbol] ?? 100;
  let price = base * (0.92 + Math.random() * 0.16);
  const now = Math.floor(Date.now() / 1000);
  // Align to candle boundaries so live updates produce strictly ascending times
  const currentCandleTime = Math.floor(now / tf) * tf;
  const candles: OHLCCandle[] = [];
  for (let i = count; i >= 0; i--) {
    const t = currentCandleTime - i * tf;
    const o = price;
    const move = (Math.random() - 0.482) * 0.022;
    const c = o * (1 + move);
    const h = Math.max(o, c) * (1 + Math.random() * 0.009);
    const l = Math.min(o, c) * (1 - Math.random() * 0.009);
    candles.push({ time: t, open: o, high: h, low: l, close: c });
    price = c;
  }
  return candles;
}

const TABS = ['Trade', 'Exposure', 'History', 'News', 'Mailbox', 'Calendar', 'Alerts', 'Journal'];

export default function App() {
  const { portfolio, marketData, isBotRunning, setIsBotRunning, logs, executeTrade, executeManualTrade, closePosition, riskSettings, setRiskSettings } = useTradingEngine();

  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [timeframe, setTimeframe] = useState('H1');
  const [activeTab, setActiveTab] = useState('Trade');
  const [mwCategory, setMwCategory] = useState<MWCategory>('crypto');
  const [showOrderTicket, setShowOrderTicket] = useState(false);
  const [candles, setCandles] = useState<OHLCCandle[]>([]);
  const [pythonStats, setPythonStats] = useState<PythonMarketStats | null>(null);
  const currentCandleRef = useRef<OHLCCandle | null>(null);
  const tfSecondsRef = useRef(3600);

  // Init candles when symbol/timeframe changes
  useEffect(() => {
    const tf = TIMEFRAMES[timeframe] ?? 3600;
    tfSecondsRef.current = tf;
    const hist = genHistory(selectedSymbol, tf);
    setCandles(hist);
    currentCandleRef.current = hist[hist.length - 1];
  }, [selectedSymbol, timeframe]);

  // Update live candle from market ticks
  useEffect(() => {
    const tick = marketData.find(m => m.symbol === selectedSymbol);
    if (!tick || candles.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    const tf = tfSecondsRef.current;
    const candleTime = Math.floor(now / tf) * tf;

    setCandles(prev => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      if (last.time === candleTime) {
        const updated = { ...last, high: Math.max(last.high, tick.price), low: Math.min(last.low, tick.price), close: tick.price };
        return [...prev.slice(0, -1), updated];
      } else {
        const newCandle: OHLCCandle = { time: candleTime, open: tick.price, high: tick.price, low: tick.price, close: tick.price };
        return [...prev.slice(-199), newCandle];
      }
    });
  }, [marketData, selectedSymbol]);

  // Python stats
  useEffect(() => {
    fetchPythonMarketStats().then(s => s && setPythonStats(s));
    const id = setInterval(() => fetchPythonMarketStats().then(s => s && setPythonStats(s)), 30000);
    return () => clearInterval(id);
  }, []);

  const totalPnL = portfolio.openPositions.reduce((sum, p) => {
    const cur = marketData.find(m => m.symbol === p.symbol);
    if (!cur) return sum;
    return sum + (cur.price - p.price) * p.quantity * (p.side === 'BUY' ? 1 : -1);
  }, 0);

  const selectedTick = marketData.find(m => m.symbol === selectedSymbol);

  return (
    <div className="mt5-root">
      {/* ── Top Toolbar ─────────────────────────────────────────── */}
      <header className="mt5-toolbar">
        <img src={Logo} alt="Tradify" className="mt5-logo" />
        <div className="mt5-toolbar-sep" />

        <button
          className={cn('mt5-btn-primary', isBotRunning && 'active')}
          onClick={() => setIsBotRunning(!isBotRunning)}
        >
          {isBotRunning ? <Pause size={12} /> : <Play size={12} />}
          Algo Trading
        </button>

        <button className="mt5-btn" onClick={() => setShowOrderTicket(true)}>
          <Plus size={12} /> New Order
        </button>

        <div className="mt5-toolbar-sep" />

        {/* Timeframe buttons */}
        {Object.keys(TIMEFRAMES).map(tf => (
          <button key={tf} className={cn('mt5-tf-btn', timeframe === tf && 'active')} onClick={() => setTimeframe(tf)}>
            {tf}
          </button>
        ))}

        <div className="mt5-toolbar-sep" />
        <div className="mt5-clock">
          <Clock size={11} />
          {new Date().toLocaleTimeString()}
        </div>

        <div style={{ flex: 1 }} />
        <div className={cn('mt5-status-badge', isBotRunning ? 'on' : 'off')}>
          {isBotRunning ? '● ALGO ON' : '○ ALGO OFF'}
        </div>
      </header>

      {/* ── Workspace ───────────────────────────────────────────── */}
      <div className="mt5-workspace">

        {/* Market Watch */}
        <aside className="mt5-market-watch">
          <div className="mt5-panel-title">Market Watch</div>

          {/* Category Tabs */}
          <div className="mw-cat-tabs">
            {MW_CATEGORIES.map(cat => (
              <button
                key={cat.key}
                data-key={cat.key}
                className={cn('mw-cat-btn', mwCategory === cat.key && 'active')}
                onClick={() => setMwCategory(cat.key)}
              >
                <span className="mw-cat-icon">{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>

          <div className="mt5-mw-header">
            <span>Symbol</span><span>Price</span><span>Chg%</span>
          </div>
          <div className="mt5-mw-list">
            {marketData
              .filter(m => mwCategory === 'all' || CATEGORY_MAP[m.symbol] === mwCategory)
              .map(m => {
                const isSelected = m.symbol === selectedSymbol;
                const isUp = m.change >= 0;
                // Smart decimal places by asset price range
                const decimals = m.price >= 1000 ? 2 : m.price >= 100 ? 2 : m.price >= 1 ? 3 : 5;
                const priceStr = '$' + m.price.toFixed(decimals);
                return (
                  <div
                    key={m.symbol}
                    className={cn('mt5-mw-row', isSelected && 'selected')}
                    onClick={() => setSelectedSymbol(m.symbol)}
                    onDoubleClick={() => { setSelectedSymbol(m.symbol); setShowOrderTicket(true); }}
                    title={`${m.symbol} — $${m.price.toFixed(decimals)} | Double-click to trade`}
                  >
                    <span className="mw-sym">{m.symbol}</span>
                    <span className={cn('mw-price', isUp ? 'up' : 'down')}>{priceStr}</span>
                    <span className={cn('mw-chg', isUp ? 'up' : 'down')}>{isUp ? '+' : ''}{m.change.toFixed(2)}%</span>
                  </div>
                );
              })}
          </div>

          {/* Portfolio summary */}
          <div className="mt5-panel-title" style={{ marginTop: 8 }}>Portfolio</div>
          <div className="mt5-portfolio-stats">
            <div><span>Balance</span><span>{formatCurrency(portfolio.balance)}</span></div>
            <div><span>Equity</span><span>{formatCurrency(portfolio.balance + totalPnL)}</span></div>
            <div><span>P&L</span><span className={totalPnL >= 0 ? 'up' : 'down'}>{formatCurrency(totalPnL)}</span></div>
            <div><span>Positions</span><span>{portfolio.openPositions.length}</span></div>
          </div>

          {pythonStats && (
            <>
              <div className="mt5-panel-title" style={{ marginTop: 8 }}>Python Stats</div>
              <div className="mt5-portfolio-stats">
                <div><span>BTC SMA7</span><span>${pythonStats.sma_7.toLocaleString()}</span></div>
                <div><span>Volatility</span><span>{(pythonStats.annualized_volatility * 100).toFixed(1)}%</span></div>
                <div><span>Drawdown</span><span>{(pythonStats.max_drawdown_30d * 100).toFixed(1)}%</span></div>
              </div>
            </>
          )}
        </aside>

        {/* Main Chart */}
        <main className="mt5-chart-area">
          {/* Chart header */}
          <div className="mt5-chart-header">
            <span className="mt5-chart-symbol">{selectedSymbol}</span>
            <span className="mt5-chart-tf">{timeframe}</span>
            {selectedTick && (
              <>
                <span className="mt5-ohlc-label">O:<span className="ohlc-val">{selectedTick.price.toFixed(2)}</span></span>
                <span className="mt5-ohlc-label">H:<span className="ohlc-val up">{(selectedTick.price * 1.003).toFixed(2)}</span></span>
                <span className="mt5-ohlc-label">L:<span className="ohlc-val down">{(selectedTick.price * 0.997).toFixed(2)}</span></span>
                <span className="mt5-ohlc-label">C:<span className={cn('ohlc-val', selectedTick.change >= 0 ? 'up' : 'down')}>{selectedTick.price.toFixed(2)}</span></span>
              </>
            )}
          </div>

          {/* Chart */}
          <div className="mt5-chart-container">
            <TradingChart candles={candles} />
          </div>
        </main>
      </div>

      {/* ── Bottom Terminal ──────────────────────────────────────── */}
      <div className="mt5-terminal">
        {/* Tabs */}
        <div className="mt5-tabs">
          {TABS.map(t => (
            <button key={t} className={cn('mt5-tab', activeTab === t && 'active')} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="mt5-tab-content">
          {activeTab === 'Trade' && (
            <table className="mt5-table">
              <thead>
                <tr><th>Symbol</th><th>Ticket</th><th>Time</th><th>Type</th><th>Volume</th><th>Price</th><th>S/L</th><th>T/P</th><th>Current</th><th>Profit</th><th></th></tr>
              </thead>
              <tbody>
                {portfolio.openPositions.length === 0 ? (
                  <tr><td colSpan={10} style={{ textAlign: 'center', color: '#555', padding: 12 }}>No open positions</td></tr>
                ) : portfolio.openPositions.map(p => {
                  const cur = marketData.find(m => m.symbol === p.symbol);
                  const pnl = cur ? (cur.price - p.price) * p.quantity * (p.side === 'BUY' ? 1 : -1) : 0;
                  return (
                    <tr key={p.id} className={pnl >= 0 ? 'profit-row' : 'loss-row'}>
                      <td>{p.symbol}</td>
                      <td className="mono">{p.id.slice(0, 8)}</td>
                      <td className="mono">{new Date(p.timestamp).toLocaleTimeString()}</td>
                      <td className={p.side === 'BUY' ? 'up' : 'down'}>{p.side}</td>
                      <td className="mono">{(p.quantity).toFixed(4)}</td>
                      <td className="mono">{p.price.toFixed(2)}</td>
                      <td className="mono dim">{p.stopLoss?.toFixed(2) ?? '-'}</td>
                      <td className="mono dim">{p.takeProfit?.toFixed(2) ?? '-'}</td>
                      <td className="mono">{cur?.price.toFixed(2) ?? '-'}</td>
                      <td className={cn('mono bold', pnl >= 0 ? 'up' : 'down')}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}</td>
                      <td><button className="close-pos-btn" onClick={() => closePosition(p.id)}>✕ Close</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {activeTab === 'History' && (
            <table className="mt5-table">
              <thead>
                <tr><th>Symbol</th><th>Ticket</th><th>Time</th><th>Type</th><th>Price</th><th>Profit</th></tr>
              </thead>
              <tbody>
                {portfolio.history.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#555', padding: 12 }}>No history yet</td></tr>
                ) : portfolio.history.slice(0, 20).map(h => (
                  <tr key={h.id}>
                    <td>{h.symbol}</td>
                    <td className="mono">{h.id.slice(0, 8)}</td>
                    <td className="mono">{new Date(h.timestamp).toLocaleTimeString()}</td>
                    <td className={h.side === 'BUY' ? 'up' : 'down'}>{h.side}</td>
                    <td className="mono">{h.price.toFixed(2)}</td>
                    <td className={cn('mono bold', (h.profit ?? 0) >= 0 ? 'up' : 'down')}>{(h.profit ?? 0) >= 0 ? '+' : ''}{(h.profit ?? 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {activeTab === 'News' && (
            <NewsPanel
              onTrade={(sym) => { setSelectedSymbol(sym); setShowOrderTicket(true); }}
            />
          )}
          {activeTab === 'Journal' && (
            <div className="mt5-log">
              {logs.map((l, i) => <div key={i} className="mt5-log-entry">{l}</div>)}
              {logs.length === 0 && <div style={{ color: '#555', padding: 8 }}>No activity yet. Start the algo engine.</div>}
            </div>
          )}
          {!['Trade', 'History', 'News', 'Journal'].includes(activeTab) && (
            <div style={{ padding: 12, color: '#555', fontSize: 12 }}>No data for {activeTab}</div>
          )}
        </div>

        {/* Status Bar */}
        <div className="mt5-status-bar">
          <span>Balance: <b>{formatCurrency(portfolio.balance)}</b></span>
          <span className="sep">|</span>
          <span>Equity: <b>{formatCurrency(portfolio.balance + totalPnL)}</b></span>
          <span className="sep">|</span>
          <span>Margin: <b>40.00</b></span>
          <span className="sep">|</span>
          <span>Free Margin: <b>{formatCurrency(portfolio.balance + totalPnL - 40)}</b></span>
          <span className="sep">|</span>
          <span className={totalPnL >= 0 ? 'up' : 'down'}>P&L: <b>{formatCurrency(totalPnL)}</b></span>
          <div style={{ flex: 1 }} />
          <span className="dim">● Market</span>
          <span className="sep">|</span>
          <span className="dim">Latency: 12ms</span>
        </div>
      </div>
      {showOrderTicket && (
        <OrderTicket
          symbol={selectedSymbol}
          marketData={marketData}
          balance={portfolio.balance}
          onPlace={executeManualTrade}
          onClose={() => setShowOrderTicket(false)}
        />
      )}
    </div>
  );
}
