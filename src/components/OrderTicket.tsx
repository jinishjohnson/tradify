/**
 * OrderTicket.tsx — MT5-style manual order entry modal
 * Supports: Market orders, BUY/SELL, volume, stop-loss, take-profit, live P&L preview
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface MarketTick {
  symbol: string;
  price: number;
  change: number;
}

interface OrderTicketProps {
  symbol: string;
  marketData: MarketTick[];
  balance: number;
  onPlace: (
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopLoss?: number,
    takeProfit?: number,
  ) => { success: boolean; message: string };
  onClose: () => void;
}

const ALL_SYMBOLS = [
  'BTC','ETH','SOL','BNB','XRP','ADA',
  'AAPL','TSLA','NVDA','MSFT','AMZN','GOOGL','META',
  'NFLX','AMD','INTC','CRM','ORCL','QCOM','AVGO',
  'JPM','V','GS','JNJ','UNH',
  'WMT','DIS','KO','PEP','HD','NKE','BA','PYPL',
  'XAUUSD','XAGUSD','USOIL','BRENT','NATGAS','COPPER',
  'PLATINUM','PALLADIUM','WHEAT','CORN','SOYBEAN',
  'COFFEE','SUGAR','COCOA','COTTON','OJ',
  'GASOLINE','HEATING','CATTLE','HOGS',
];

export function OrderTicket({ symbol: initSymbol, marketData, balance, onPlace, onClose }: OrderTicketProps) {
  const [symbol, setSymbol]     = useState(initSymbol);
  const [side, setSide]         = useState<'BUY' | 'SELL'>('BUY');
  const [volume, setVolume]     = useState('0.01');
  const [slEnabled, setSlEnabled] = useState(false);
  const [tpEnabled, setTpEnabled] = useState(false);
  const [slValue, setSlValue]   = useState('');
  const [tpValue, setTpValue]   = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [placed, setPlaced]     = useState(false);

  const tick = marketData.find(m => m.symbol === symbol);
  const price = tick?.price ?? 0;
  const qty   = parseFloat(volume) || 0;
  const cost  = price * qty;
  const dec   = price >= 100 ? 2 : price >= 1 ? 4 : 6;

  // Auto-suggest SL / TP when price or side changes
  useEffect(() => {
    if (!price) return;
    const slDist = price * 0.02; // 2% away
    const tpDist = price * 0.04; // 4% away (2:1 RR)
    setSlValue((side === 'BUY' ? price - slDist : price + slDist).toFixed(dec));
    setTpValue((side === 'BUY' ? price + tpDist : price - tpDist).toFixed(dec));
  }, [symbol, side, price, dec]);

  const pnlAtSL = slEnabled && slValue
    ? (parseFloat(slValue) - price) * qty * (side === 'BUY' ? 1 : -1)
    : null;
  const pnlAtTP = tpEnabled && tpValue
    ? (parseFloat(tpValue) - price) * qty * (side === 'BUY' ? 1 : -1)
    : null;

  const handlePlace = useCallback(() => {
    const result = onPlace(
      symbol,
      side,
      qty,
      slEnabled && slValue ? parseFloat(slValue) : undefined,
      tpEnabled && tpValue ? parseFloat(tpValue) : undefined,
    );
    setFeedback({ ok: result.success, msg: result.message });
    if (result.success) {
      setPlaced(true);
      setTimeout(onClose, 1800);
    }
  }, [symbol, side, qty, slEnabled, slValue, tpEnabled, tpValue, onPlace, onClose]);

  // Handle Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="ot-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ot-modal">

        {/* Header */}
        <div className="ot-header">
          <span className="ot-title">New Order</span>
          <button className="ot-close" onClick={onClose}><X size={14} /></button>
        </div>

        {/* Symbol selector */}
        <div className="ot-row">
          <label className="ot-label">Symbol</label>
          <select className="ot-select" value={symbol} onChange={e => setSymbol(e.target.value)}>
            <optgroup label="Crypto">
              {['BTC','ETH','SOL','BNB','XRP','ADA'].map(s => <option key={s}>{s}</option>)}
            </optgroup>
            <optgroup label="Stocks">
              {['AAPL','TSLA','NVDA','MSFT','AMZN','GOOGL','META',
                'NFLX','AMD','INTC','CRM','ORCL','QCOM','AVGO',
                'JPM','V','GS','JNJ','UNH',
                'WMT','DIS','KO','PEP','HD','NKE','BA','PYPL'].map(s => <option key={s}>{s}</option>)}
            </optgroup>
            <optgroup label="Commodities">
              {['XAUUSD','XAGUSD','USOIL','BRENT','NATGAS','COPPER',
                'PLATINUM','PALLADIUM','WHEAT','CORN','SOYBEAN',
                'COFFEE','SUGAR','COCOA','COTTON','OJ',
                'GASOLINE','HEATING','CATTLE','HOGS'].map(s => <option key={s}>{s}</option>)}
            </optgroup>
          </select>
        </div>

        {/* Live price banner */}
        <div className={cn('ot-price-banner', tick && tick.change >= 0 ? 'up' : 'down')}>
          <span className="ot-price-val">{price ? price.toFixed(dec) : '—'}</span>
          <span className="ot-price-chg">
            {tick ? `${tick.change >= 0 ? '+' : ''}${tick.change.toFixed(2)}%` : ''}
          </span>
        </div>

        {/* BUY / SELL toggle */}
        <div className="ot-side-toggle">
          <button
            className={cn('ot-side-btn buy', side === 'BUY' && 'active')}
            onClick={() => setSide('BUY')}
          >
            <TrendingUp size={14} /> BUY
          </button>
          <button
            className={cn('ot-side-btn sell', side === 'SELL' && 'active')}
            onClick={() => setSide('SELL')}
          >
            <TrendingDown size={14} /> SELL
          </button>
        </div>

        {/* Volume */}
        <div className="ot-row">
          <label className="ot-label">Volume (units)</label>
          <div className="ot-input-row">
            <button className="ot-stepper" onClick={() => setVolume(v => Math.max(0.0001, (parseFloat(v) || 0) - 0.01).toFixed(4))}>−</button>
            <input
              className="ot-input"
              type="number"
              step="0.01"
              min="0.0001"
              value={volume}
              onChange={e => setVolume(e.target.value)}
            />
            <button className="ot-stepper" onClick={() => setVolume(v => ((parseFloat(v) || 0) + 0.01).toFixed(4))}>+</button>
          </div>
        </div>

        {/* Stop Loss */}
        <div className="ot-row">
          <label className="ot-label">
            <input type="checkbox" checked={slEnabled} onChange={e => setSlEnabled(e.target.checked)} />
            &nbsp;Stop Loss
            {pnlAtSL !== null && (
              <span className={pnlAtSL >= 0 ? 'ot-pnl up' : 'ot-pnl down'}>
                {pnlAtSL >= 0 ? '+' : ''}${pnlAtSL.toFixed(2)}
              </span>
            )}
          </label>
          <input
            className={cn('ot-input', !slEnabled && 'disabled')}
            type="number"
            step="0.01"
            value={slValue}
            disabled={!slEnabled}
            onChange={e => setSlValue(e.target.value)}
          />
        </div>

        {/* Take Profit */}
        <div className="ot-row">
          <label className="ot-label">
            <input type="checkbox" checked={tpEnabled} onChange={e => setTpEnabled(e.target.checked)} />
            &nbsp;Take Profit
            {pnlAtTP !== null && (
              <span className={pnlAtTP >= 0 ? 'ot-pnl up' : 'ot-pnl down'}>
                {pnlAtTP >= 0 ? '+' : ''}${pnlAtTP.toFixed(2)}
              </span>
            )}
          </label>
          <input
            className={cn('ot-input', !tpEnabled && 'disabled')}
            type="number"
            step="0.01"
            value={tpValue}
            disabled={!tpEnabled}
            onChange={e => setTpValue(e.target.value)}
          />
        </div>

        {/* Order summary */}
        <div className="ot-summary">
          <div><span>Order Cost</span><span className={cost > balance ? 'down' : ''}>${cost.toFixed(2)}</span></div>
          <div><span>Available</span><span>${balance.toFixed(2)}</span></div>
          <div><span>Type</span><span>Market</span></div>
        </div>

        {/* Insufficient funds warning */}
        {cost > balance && (
          <div className="ot-warn">
            <AlertTriangle size={12} /> Insufficient funds
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={cn('ot-feedback', feedback.ok ? 'ok' : 'err')}>
            {feedback.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {feedback.msg}
          </div>
        )}

        {/* Actions */}
        <div className="ot-actions">
          <button className="ot-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className={cn('ot-btn-place', side === 'BUY' ? 'buy' : 'sell', (cost > balance || qty <= 0 || placed) && 'disabled')}
            disabled={cost > balance || qty <= 0 || placed}
            onClick={handlePlace}
          >
            {placed ? '✓ Placed' : `Place ${side} @ Market`}
          </button>
        </div>

      </div>
    </div>
  );
}
