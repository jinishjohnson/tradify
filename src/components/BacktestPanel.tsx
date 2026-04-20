/**
 * BacktestPanel.tsx — Strategy backtesting UI
 * Sends config to Python backend, renders equity curve + metrics
 */
import React, { useState, useCallback } from 'react';
import { Play, TrendingUp, TrendingDown, BarChart2, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface BacktestResult {
  symbol: string;
  strategy: string;
  period: string;
  initial_capital: number;
  final_equity: number;
  total_return_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  total_trades: number;
  win_rate_pct: number;
  equity_curve: { date: string; equity: number }[];
  trades: { type: string; date: string; price: number; profit: number | null }[];
}

const STRATEGIES = [
  { key: 'MA_CROSSOVER', label: 'MA Crossover', desc: 'Fast vs Slow moving average' },
  { key: 'RSI',          label: 'RSI',          desc: 'Oversold < 30, Overbought > 70' },
  { key: 'MACD',         label: 'MACD',         desc: 'MACD line vs Signal line' },
];

const PERIODS = ['1mo','3mo','6mo','1y','2y','5y'];

const SYMBOLS = [
  'AAPL','TSLA','NVDA','MSFT','AMZN','GOOGL','META',
  'BTC-USD','ETH-USD','SOL-USD',
  'GC=F','CL=F', // Gold, Oil yfinance tickers
];

export function BacktestPanel() {
  const [symbol, setSymbol]     = useState('AAPL');
  const [strategy, setStrategy] = useState('MA_CROSSOVER');
  const [period, setPeriod]     = useState('1y');
  const [capital, setCapital]   = useState('10000');
  const [fast, setFast]         = useState('10');
  const [slow, setSlow]         = useState('30');
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<BacktestResult | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<'unknown'|'ok'|'offline'>('unknown');

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/python/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          strategy,
          period,
          fast: parseInt(fast) || 10,
          slow: parseInt(slow) || 30,
          initial_capital: parseFloat(capital) || 10000,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: BacktestResult = await res.json();
      setResult(data);
      setBackendStatus('ok');
    } catch (e: any) {
      if (e.message?.includes('fetch') || e.message?.includes('ECONNREFUSED')) {
        setBackendStatus('offline');
        setError('Python backend is not running. Start it with: cd backend && python main.py');
      } else {
        setError(e.message ?? 'Unknown error');
      }
    } finally {
      setLoading(false);
    }
  }, [symbol, strategy, period, fast, slow, capital]);

  // Mini equity curve SVG
  const renderEquityCurve = (curve: BacktestResult['equity_curve']) => {
    if (curve.length < 2) return null;
    const w = 540, h = 80;
    const vals = curve.map(c => c.equity);
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    const pts = vals.map((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    }).join(' ');
    const isUp = vals[vals.length - 1] >= vals[0];
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="bt-curve-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="bt-grad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={isUp ? '#26a69a' : '#ef5350'} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={isUp ? '#26a69a' : '#ef5350'} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon points={`0,${h} ${pts} ${w},${h}`} fill="url(#bt-grad)" />
        <polyline points={pts} fill="none" stroke={isUp ? '#26a69a' : '#ef5350'} strokeWidth="1.5"/>
      </svg>
    );
  };

  const isUp = result && result.total_return_pct >= 0;

  return (
    <div className="bt-root">
      {/* Config panel */}
      <div className="bt-config">
        <div className="bt-config-title">
          <BarChart2 size={13} /> Backtest Configuration
          {backendStatus === 'offline' && <span className="bt-badge offline">Python Backend Offline</span>}
          {backendStatus === 'ok' && <span className="bt-badge online">● Connected</span>}
        </div>

        <div className="bt-config-grid">
          <div className="bt-field">
            <label>Symbol</label>
            <select value={symbol} onChange={e => setSymbol(e.target.value)}>
              {SYMBOLS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="bt-field">
            <label>Strategy</label>
            <select value={strategy} onChange={e => setStrategy(e.target.value)}>
              {STRATEGIES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          <div className="bt-field">
            <label>Period</label>
            <div className="bt-period-btns">
              {PERIODS.map(p => (
                <button key={p} className={cn('bt-period-btn', period === p && 'active')} onClick={() => setPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>

          <div className="bt-field">
            <label>Capital ($)</label>
            <input type="number" value={capital} onChange={e => setCapital(e.target.value)} min="100"/>
          </div>

          {(strategy === 'MA_CROSSOVER' || strategy === 'MACD') && (
            <>
              <div className="bt-field">
                <label>Fast Period</label>
                <input type="number" value={fast} onChange={e => setFast(e.target.value)} min="2" max="200"/>
              </div>
              <div className="bt-field">
                <label>Slow Period</label>
                <input type="number" value={slow} onChange={e => setSlow(e.target.value)} min="2" max="200"/>
              </div>
            </>
          )}
          {strategy === 'RSI' && (
            <div className="bt-field">
              <label>RSI Period</label>
              <input type="number" value={fast} onChange={e => setFast(e.target.value)} min="2" max="50"/>
            </div>
          )}
        </div>

        <button className={cn('bt-run-btn', loading && 'loading')} onClick={runBacktest} disabled={loading}>
          {loading ? <><Loader2 size={13} className="spin"/> Running...</> : <><Play size={13}/> Run Backtest</>}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bt-error">
          <AlertTriangle size={13}/> {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bt-results">
          <div className="bt-results-header">
            <span className="bt-results-title">{result.symbol} · {result.strategy} · {result.period}</span>
          </div>

          {/* Metrics row */}
          <div className="bt-metrics">
            <div className={cn('bt-metric', isUp ? 'up' : 'down')}>
              <span>Total Return</span>
              <b>{result.total_return_pct >= 0 ? '+' : ''}{result.total_return_pct}%</b>
            </div>
            <div className={cn('bt-metric', result.sharpe_ratio >= 1 ? 'up' : result.sharpe_ratio >= 0 ? '' : 'down')}>
              <span>Sharpe Ratio</span>
              <b>{result.sharpe_ratio}</b>
            </div>
            <div className="bt-metric down">
              <span>Max Drawdown</span>
              <b>{result.max_drawdown_pct}%</b>
            </div>
            <div className={cn('bt-metric', result.win_rate_pct >= 50 ? 'up' : 'down')}>
              <span>Win Rate</span>
              <b>{result.win_rate_pct}%</b>
            </div>
            <div className="bt-metric">
              <span>Trades</span>
              <b>{result.total_trades}</b>
            </div>
            <div className={cn('bt-metric', isUp ? 'up' : 'down')}>
              <span>Final Equity</span>
              <b>${result.final_equity.toLocaleString()}</b>
            </div>
          </div>

          {/* Equity curve */}
          <div className="bt-curve-wrap">
            <div className="bt-curve-label">Equity Curve</div>
            {renderEquityCurve(result.equity_curve)}
            <div className="bt-curve-axis">
              <span>${Math.min(...result.equity_curve.map(c => c.equity)).toFixed(0)}</span>
              <span>{result.equity_curve[0]?.date}</span>
              <span>{result.equity_curve[result.equity_curve.length - 1]?.date}</span>
              <span>${Math.max(...result.equity_curve.map(c => c.equity)).toFixed(0)}</span>
            </div>
          </div>

          {/* Recent trades */}
          <div className="bt-curve-label" style={{ padding: '4px 10px' }}>Recent Signals</div>
          <div className="bt-trades-list">
            {result.trades.filter(t => t.profit !== null).slice(-12).reverse().map((t, i) => (
              <div key={i} className={cn('bt-trade-row', t.type === 'BUY' ? 'buy' : 'sell')}>
                <span className="bt-trade-type">{t.type}</span>
                <span className="bt-trade-date">{t.date}</span>
                <span className="bt-trade-price">${t.price.toFixed(2)}</span>
                <span className={cn('bt-trade-pnl', (t.profit ?? 0) >= 0 ? 'up' : 'down')}>
                  {t.profit !== null ? `${(t.profit ?? 0) >= 0 ? '+' : ''}$${(t.profit ?? 0).toFixed(2)}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="bt-empty">
          <BarChart2 size={32} opacity={0.2}/>
          <p>Configure a strategy above and click <b>Run Backtest</b></p>
          <p className="bt-empty-note">Requires Python backend: <code>cd backend && python main.py</code></p>
        </div>
      )}
    </div>
  );
}
