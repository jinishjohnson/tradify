/**
 * AlgoTradeModal.tsx — Popup for selecting trading category
 */

import React, { useEffect } from 'react';
import { X, Bitcoin, BarChart3, Package, Play } from 'lucide-react';
import { cn } from '../lib/utils';

interface AlgoTradeModalProps {
  onSelect: (category: 'crypto' | 'stocks' | 'commodities') => void;
  onClose: () => void;
}

export function AlgoTradeModal({ onSelect, onClose }: AlgoTradeModalProps) {
  // Handle Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const categories = [
    {
      id: 'crypto' as const,
      label: 'Crypto',
      desc: 'Trade BTC, ETH, and other liquid crypto assets.',
      icon: <Bitcoin size={32} className="text-amber-500" />,
      color: 'crypto',
    },
    {
      id: 'stocks' as const,
      label: 'Stocks',
      desc: 'Trade AAPL, TSLA, and other major US stocks.',
      icon: <BarChart3 size={32} className="text-emerald-500" />,
      color: 'stocks',
    },
    {
      id: 'commodities' as const,
      label: 'Commodities',
      desc: 'Trade Gold, Oil, Silver, and agricultural assets.',
      icon: <Package size={32} className="text-orange-500" />,
      color: 'commodities',
    }
  ];

  return (
    <div className="ot-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ot-modal algo-modal">
        {/* Header */}
        <div className="ot-header">
          <span className="ot-title">Start Algo Engine</span>
          <button className="ot-close" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="algo-modal-content">
          <p className="algo-modal-subtitle">Select a category for the bot to trade:</p>
          
          <div className="algo-cards">
            {categories.map((cat) => (
              <div 
                key={cat.id} 
                className={cn('algo-card', `algo-card-${cat.color}`)}
                onClick={() => onSelect(cat.id)}
              >
                <div className="algo-card-icon">
                  {cat.icon}
                </div>
                <div className="algo-card-info">
                  <h3>{cat.label}</h3>
                  <p>{cat.desc}</p>
                </div>
                <div className="algo-card-action">
                  <span className="algo-start-btn">
                    <Play size={12} fill="currentColor" /> Start
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="algo-modal-footer">
          <button className="ot-btn-cancel" onClick={onClose} style={{ width: '100%', flex: 'none' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
