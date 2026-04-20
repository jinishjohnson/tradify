from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Optional
import argparse
import socket

app = FastAPI(title="Tradify Python Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"message": "Tradify Python Backend. Visit /docs for API."}


# ── Market Stats ──────────────────────────────────────────────────────────────

@app.get("/api/python/market-stats")
async def get_market_stats():
    """BTC rolling metrics using mock historical data + pandas."""
    dates = pd.date_range(end=datetime.now(), periods=30)
    np.random.seed(42)
    returns = np.random.normal(loc=0.001, scale=0.02, size=30)
    prices = 60000 * np.exp(np.cumsum(returns))
    df = pd.DataFrame({"Date": dates, "Price": prices})
    df['SMA_7'] = df['Price'].rolling(window=7).mean()
    df['Daily_Return'] = df['Price'].pct_change()
    volatility = float(df['Daily_Return'].std() * np.sqrt(365))
    max_drawdown = float((df['Price'].max() - df['Price'].min()) / df['Price'].max())
    return {
        "symbol": "BTC",
        "current_price": round(float(df['Price'].iloc[-1]), 2),
        "sma_7": round(float(df['SMA_7'].iloc[-1]), 2),
        "annualized_volatility": round(volatility, 4),
        "max_drawdown_30d": round(max_drawdown, 4),
        "data_points": len(df),
    }


# ── Backtest ──────────────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    symbol: str = "AAPL"
    strategy: str = "MA_CROSSOVER"   # MA_CROSSOVER | RSI | MACD
    period: str = "1y"               # 1mo, 3mo, 6mo, 1y, 2y, 5y
    fast: Optional[int] = 10        # fast MA / RSI period
    slow: Optional[int] = 30        # slow MA
    initial_capital: float = 10000.0


@app.post("/api/python/backtest")
async def run_backtest(req: BacktestRequest):
    """Run a simple strategy backtest using yfinance data."""
    try:
        import yfinance as yf
    except ImportError:
        raise HTTPException(503, "yfinance not installed. Run: pip install yfinance")

    try:
        ticker = yf.Ticker(req.symbol)
        hist = ticker.history(period=req.period)
        if hist.empty:
            raise HTTPException(404, f"No data found for symbol: {req.symbol}")
    except Exception as e:
        raise HTTPException(502, f"yfinance error: {str(e)}")

    df = hist[['Close', 'Volume']].copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)

    # ── Strategy signals ──────────────────────────────────────────────────────
    if req.strategy == "MA_CROSSOVER":
        fast = req.fast or 10
        slow = req.slow or 30
        df['fast_ma'] = df['Close'].rolling(fast).mean()
        df['slow_ma'] = df['Close'].rolling(slow).mean()
        df['signal'] = np.where(df['fast_ma'] > df['slow_ma'], 1, -1)

    elif req.strategy == "RSI":
        period = req.fast or 14
        delta = df['Close'].diff()
        gain = delta.clip(lower=0).rolling(period).mean()
        loss = (-delta.clip(upper=0)).rolling(period).mean()
        rs = gain / loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))
        df['rsi'] = rsi
        df['signal'] = np.where(rsi < 30, 1, np.where(rsi > 70, -1, 0))

    elif req.strategy == "MACD":
        fast = req.fast or 12
        slow = req.slow or 26
        signal_period = 9
        ema_fast = df['Close'].ewm(span=fast).mean()
        ema_slow = df['Close'].ewm(span=slow).mean()
        macd = ema_fast - ema_slow
        signal_line = macd.ewm(span=signal_period).mean()
        df['macd'] = macd
        df['signal_line'] = signal_line
        df['signal'] = np.where(macd > signal_line, 1, -1)

    else:
        raise HTTPException(400, f"Unknown strategy: {req.strategy}")

    # ── Simulate trades ───────────────────────────────────────────────────────
    df = df.dropna()
    capital = req.initial_capital
    position = 0.0
    shares = 0.0
    trades = []
    equity_curve = []
    entry_price = 0.0

    for i, (ts, row) in enumerate(df.iterrows()):
        sig = int(row['signal'])
        price = float(row['Close'])
        equity = capital + shares * price
        equity_curve.append({"date": ts.strftime("%Y-%m-%d"), "equity": round(equity, 2)})

        if sig == 1 and position <= 0:  # BUY
            if position < 0:  # close short first
                profit = (entry_price - price) * abs(shares)
                capital += profit
                trades.append({"type": "CLOSE_SHORT", "date": ts.strftime("%Y-%m-%d"), "price": round(price, 2), "profit": round(profit, 2)})
            shares = (capital * 0.95) / price
            capital -= shares * price
            entry_price = price
            position = 1
            trades.append({"type": "BUY", "date": ts.strftime("%Y-%m-%d"), "price": round(price, 2), "profit": None})

        elif sig == -1 and position >= 0:  # SELL
            if position > 0:  # close long first
                profit = (price - entry_price) * shares
                capital += shares * price
                trades.append({"type": "SELL", "date": ts.strftime("%Y-%m-%d"), "price": round(price, 2), "profit": round(profit, 2)})
                shares = 0.0
                position = -1

    # Close any open position at end
    final_price = float(df['Close'].iloc[-1])
    final_equity = capital + shares * final_price

    # ── Metrics ───────────────────────────────────────────────────────────────
    eq_series = pd.Series([e['equity'] for e in equity_curve])
    daily_returns = eq_series.pct_change().dropna()
    sharpe = float(daily_returns.mean() / daily_returns.std() * np.sqrt(252)) if daily_returns.std() > 0 else 0
    roll_max = eq_series.cummax()
    drawdown = (eq_series - roll_max) / roll_max
    max_dd = float(drawdown.min())
    total_return = (final_equity - req.initial_capital) / req.initial_capital
    closed_trades = [t for t in trades if t['profit'] is not None]
    winners = [t for t in closed_trades if (t['profit'] or 0) > 0]
    win_rate = len(winners) / len(closed_trades) if closed_trades else 0

    return {
        "symbol": req.symbol,
        "strategy": req.strategy,
        "period": req.period,
        "initial_capital": req.initial_capital,
        "final_equity": round(final_equity, 2),
        "total_return_pct": round(total_return * 100, 2),
        "sharpe_ratio": round(sharpe, 3),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "total_trades": len(closed_trades),
        "win_rate_pct": round(win_rate * 100, 1),
        "equity_curve": equity_curve[-252:],  # last 252 days max
        "trades": trades[-50:],              # last 50 trade signals
    }


def find_available_port(start_port: int, host: str = "0.0.0.0") -> int:
    """Return first available port at or above start_port."""
    port = start_port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
                return port
            except OSError:
                pass
        port += 1


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser(description="Run Tradify Python backend")
    parser.add_argument("command", nargs="?", default="runserver")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    if args.command != "runserver":
        raise SystemExit(f"Unknown command: {args.command}. Use: runserver")

    selected_port = find_available_port(args.port, args.host)
    if selected_port != args.port:
        print(f"Port {args.port} is in use; starting server on {selected_port} instead.")

    uvicorn.run(app, host=args.host, port=selected_port)

