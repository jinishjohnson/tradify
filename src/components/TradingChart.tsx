import React, { useEffect, useRef } from 'react';
import {
  createChart,
  CrosshairMode,
  LineStyle,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';

export interface OHLCCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function ema(data: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const r = [data[0]];
  for (let i = 1; i < data.length; i++) r.push(data[i] * k + r[i - 1] * (1 - k));
  return r;
}

function calcMACD(closes: number[]) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const macd = closes.map((_, i) => e12[i] - e26[i]);
  const signal = ema(macd, 9);
  return { macd, signal, hist: macd.map((v, i) => v - signal[i]) };
}

function calcStoch(closes: number[], highs: number[], lows: number[], n = 14) {
  const K: number[] = [];
  for (let i = n - 1; i < closes.length; i++) {
    const h = Math.max(...highs.slice(i - n + 1, i + 1));
    const l = Math.min(...lows.slice(i - n + 1, i + 1));
    K.push(h === l ? 50 : ((closes[i] - l) / (h - l)) * 100);
  }
  const D = K.slice(2).map((_, i) => (K[i] + K[i + 1] + K[i + 2]) / 3);
  return { K, D };
}

const DARK = '#131722', GRID = '#1e222d', TEXT = '#b2b5be', BORDER = '#2a2e39';

const baseOpts = {
  layout: { background: { color: DARK }, textColor: TEXT },
  grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: BORDER },
  timeScale: { borderColor: BORDER, timeVisible: true, secondsVisible: false },
};

export const TradingChart: React.FC<{ candles: OHLCCandle[] }> = ({ candles }) => {
  const mainRef = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const stochRef = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!mainRef.current || !macdRef.current || !stochRef.current || candles.length < 30) return;
    cleanup.current?.();

    // ── Main chart (candlestick) ─────────────────────────────────
    const main = createChart(mainRef.current, {
      ...baseOpts,
      width: mainRef.current.clientWidth,
      height: mainRef.current.clientHeight,
    });
    const cs = main.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });
    cs.setData(candles as any);
    main.timeScale().fitContent();

    // ── MACD chart ───────────────────────────────────────────────
    const macdChart = createChart(macdRef.current, {
      ...baseOpts,
      width: macdRef.current.clientWidth,
      height: macdRef.current.clientHeight,
      timeScale: { ...baseOpts.timeScale, visible: false },
    });
    const closes = candles.map(c => c.close);
    const { macd, signal, hist } = calcMACD(closes);
    const histS  = macdChart.addSeries(HistogramSeries, { priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
    const macdS  = macdChart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 1 });
    const signalS = macdChart.addSeries(LineSeries, { color: '#ff6d00', lineWidth: 1, lineStyle: LineStyle.Dashed });
    histS.setData(candles.map((c, i) => ({ time: c.time, value: hist[i], color: hist[i] >= 0 ? '#26a69a88' : '#ef535088' })) as any);
    macdS.setData(candles.map((c, i) => ({ time: c.time, value: macd[i] })) as any);
    signalS.setData(candles.map((c, i) => ({ time: c.time, value: signal[i] })) as any);

    // ── Stochastic chart ─────────────────────────────────────────
    const stochChart = createChart(stochRef.current, {
      ...baseOpts,
      width: stochRef.current.clientWidth,
      height: stochRef.current.clientHeight,
    });
    const highs = candles.map(c => c.high), lows = candles.map(c => c.low);
    const { K, D } = calcStoch(closes, highs, lows);
    const off = candles.length - K.length;
    const kS = stochChart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 1 });
    const dS = stochChart.addSeries(LineSeries, { color: '#ff6d00', lineWidth: 1, lineStyle: LineStyle.Dashed });
    kS.setData(candles.slice(off).map((c, i) => ({ time: c.time, value: K[i] })) as any);
    dS.setData(candles.slice(off + 2).map((c, i) => ({ time: c.time, value: D[i] })) as any);

    // ── Sync time scales ─────────────────────────────────────────
    main.timeScale().subscribeVisibleLogicalRangeChange(r => {
      if (r) { macdChart.timeScale().setVisibleLogicalRange(r); stochChart.timeScale().setVisibleLogicalRange(r); }
    });

    const onResize = () => {
      if (mainRef.current)  main.applyOptions({ width: mainRef.current.clientWidth });
      if (macdRef.current)  macdChart.applyOptions({ width: macdRef.current.clientWidth });
      if (stochRef.current) stochChart.applyOptions({ width: stochRef.current.clientWidth });
    };
    window.addEventListener('resize', onResize);

    cleanup.current = () => {
      window.removeEventListener('resize', onResize);
      main.remove(); macdChart.remove(); stochChart.remove();
    };
    return () => { cleanup.current?.(); cleanup.current = null; };
  }, [candles]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: DARK }}>
      <div ref={mainRef} style={{ flex: '1 1 60%', width: '100%' }} />
      <div style={{ height: 1, background: BORDER }} />
      <div style={{ padding: '2px 8px', fontSize: 10, color: '#555', background: '#1a1d27' }}>MACD(12,26,9) · 0.002,120,9) 0.002,120 0.000346</div>
      <div ref={macdRef} style={{ flex: '0 0 20%', width: '100%' }} />
      <div style={{ height: 1, background: BORDER }} />
      <div style={{ padding: '2px 8px', fontSize: 10, color: '#555', background: '#1a1d27' }}>Stochastic(14,3,3) 50.04 35.96</div>
      <div ref={stochRef} style={{ flex: '0 0 20%', width: '100%' }} />
    </div>
  );
};
