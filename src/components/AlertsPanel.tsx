/**
 * AlertsPanel.tsx — Price alert manager
 * Users set price alerts; the engine checks them on every market tick.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Bell, BellRing, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: 'above' | 'below';
  targetPrice: number;
  triggered: boolean;
  createdAt: string;
}

interface AlertsPanelProps {
  marketData: { symbol: string; price: number }[];
  alerts: PriceAlert[];
  onAddAlert: (symbol: string, condition: 'above' | 'below', price: number) => void;
  onRemoveAlert: (id: string) => void;
}

const ALL_SYMBOLS = [
  'BTC','ETH','SOL','BNB','XRP','ADA',
  'AAPL','TSLA','NVDA','MSFT','AMZN','GOOGL','META',
  'XAUUSD','XAGUSD','USOIL','NATGAS','COPPER',
];

export function AlertsPanel({ marketData, alerts, onAddAlert, onRemoveAlert }: AlertsPanelProps) {
  const [symbol, setSymbol]       = useState('BTC');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [price, setPrice]         = useState('');

  const tick = marketData.find(m => m.symbol === symbol);

  const handleAdd = useCallback(() => {
    const p = parseFloat(price);
    if (!p || p <= 0) return;
    onAddAlert(symbol, condition, p);
    setPrice('');
  }, [symbol, condition, price, onAddAlert]);

  const triggeredAlerts = alerts.filter(a => a.triggered);
  const pendingAlerts = alerts.filter(a => !a.triggered);

  return (
    <div className="alerts-root">
      {/* Add alert form */}
      <div className="alerts-form">
        <div className="alerts-form-title"><Bell size={12}/> New Price Alert</div>
        <div className="alerts-form-row">
          <select value={symbol} onChange={e => setSymbol(e.target.value)} className="al-select">
            {ALL_SYMBOLS.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={condition} onChange={e => setCondition(e.target.value as any)} className="al-select al-select-cond">
            <option value="above">Above ↑</option>
            <option value="below">Below ↓</option>
          </select>
          <input
            className="al-input"
            type="number"
            placeholder={tick ? tick.price.toFixed(2) : 'Price'}
            value={price}
            onChange={e => setPrice(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            step="0.01"
          />
          <button className="al-add-btn" onClick={handleAdd} disabled={!price}>
            <Plus size={12}/> Add
          </button>
        </div>
        {tick && (
          <div className="al-current-price">
            Current {symbol}: <b>${tick.price.toFixed(tick.price >= 1 ? 2 : 6)}</b>
          </div>
        )}
      </div>

      {/* Triggered alerts */}
      {triggeredAlerts.length > 0 && (
        <div className="alerts-section">
          <div className="alerts-section-title triggered"><BellRing size={11}/> Triggered ({triggeredAlerts.length})</div>
          {triggeredAlerts.map(a => (
            <div key={a.id} className="alert-row triggered">
              <CheckCircle2 size={12} className="al-icon triggered"/>
              <span className="al-sym">{a.symbol}</span>
              <span className="al-cond">{a.condition}</span>
              <span className="al-price">${a.targetPrice.toFixed(2)}</span>
              <button className="al-del-btn" onClick={() => onRemoveAlert(a.id)}><Trash2 size={10}/></button>
            </div>
          ))}
        </div>
      )}

      {/* Pending alerts */}
      <div className="alerts-section">
        <div className="alerts-section-title">
          <Bell size={11}/> Active Alerts ({pendingAlerts.length})
        </div>
        {pendingAlerts.length === 0 ? (
          <div className="alerts-empty">No alerts set. Add one above.</div>
        ) : pendingAlerts.map(a => {
          const cur = marketData.find(m => m.symbol === a.symbol);
          const dec = (a.targetPrice >= 1) ? 2 : 6;
          const dist = cur ? ((a.targetPrice - cur.price) / cur.price * 100) : null;
          return (
            <div key={a.id} className="alert-row">
              <Bell size={12} className="al-icon"/>
              <span className="al-sym">{a.symbol}</span>
              <span className={cn('al-cond', a.condition === 'above' ? 'up' : 'down')}>
                {a.condition === 'above' ? '↑' : '↓'}
              </span>
              <span className="al-price">${a.targetPrice.toFixed(dec)}</span>
              {dist !== null && (
                <span className={cn('al-dist', Math.abs(dist) < 1 ? 'near' : '')}>
                  {dist >= 0 ? '+' : ''}{dist.toFixed(1)}%
                </span>
              )}
              <button className="al-del-btn" onClick={() => onRemoveAlert(a.id)}><Trash2 size={10}/></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
