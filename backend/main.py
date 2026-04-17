from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

app = FastAPI(title="Tradify Python Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

@app.get("/")
async def root():
    return {"message": "Tradify Python Backend is running. Visit /docs for the API documentation."}


@app.get("/api/python/market-stats")
async def get_market_stats():
    # Generate 30 days of mock historical data for BTC using pandas
    dates = pd.date_range(end=datetime.now(), periods=30)
    
    # Simulate a random walk for prices
    np.random.seed(42)  # For reproducible mock data, or remove for dynamic
    returns = np.random.normal(loc=0.001, scale=0.02, size=30)
    prices = 60000 * np.exp(np.cumsum(returns))
    
    df = pd.DataFrame({
        "Date": dates,
        "Price": prices,
        "Volume": np.random.randint(1000, 5000, size=30) * 1000000
    })
    
    # Calculate some metrics using pandas
    df['SMA_7'] = df['Price'].rolling(window=7).mean()
    df['Daily_Return'] = df['Price'].pct_change()
    
    # Calculate volatility (std dev of returns * sqrt(365) for annualized)
    volatility = float(df['Daily_Return'].std() * np.sqrt(365))
    
    # Get latest metrics
    latest_price = float(df['Price'].iloc[-1])
    latest_sma = float(df['SMA_7'].iloc[-1])
    max_drawdown = float((df['Price'].max() - df['Price'].min()) / df['Price'].max())
    
    # We could also format the historical data to be sent to the chart,
    # but for now we'll just return the calculated advanced metrics.
    
    return {
        "symbol": "BTC",
        "current_price": round(latest_price, 2),
        "sma_7": round(latest_sma, 2),
        "annualized_volatility": round(volatility, 4),
        "max_drawdown_30d": round(max_drawdown, 4),
        "data_points": len(df)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
