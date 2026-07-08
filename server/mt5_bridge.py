"""
============================================================
 MT5 BRIDGE — local server that connects Trade Master (web)
 to a real MetaTrader 5 terminal.

 RUN THIS ON THE WINDOWS MACHINE WHERE MT5 IS INSTALLED:
   pip install flask flask-cors MetaTrader5
   python mt5_bridge.py

 The MT5 terminal must be running and logged in.
 The web page then connects to  http://127.0.0.1:5000
============================================================
"""

from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    mt5 = None
    MT5_AVAILABLE = False

app = Flask(__name__)
CORS(app)  # allow the web terminal to call us

_initialized = False


def ensure_mt5():
    """Initialize the MT5 connection once, reuse it after."""
    global _initialized
    if not MT5_AVAILABLE:
        raise RuntimeError("MetaTrader5 package not installed (Windows only).")
    if not _initialized:
        if not mt5.initialize():
            raise RuntimeError(f"mt5.initialize() failed: {mt5.last_error()}")
        _initialized = True


@app.route("/health")
def health():
    return jsonify({"ok": True, "mt5": MT5_AVAILABLE})


@app.route("/account")
def account():
    ensure_mt5()
    info = mt5.account_info()
    if info is None:
        return jsonify({"error": "no account — is MT5 logged in?"}), 500
    return jsonify({
        "login": info.login,
        "equity": info.equity,
        "balance": info.balance,
        "currency": info.currency,
        "margin_free": info.margin_free,
    })


@app.route("/positions")
def positions():
    ensure_mt5()
    pos = mt5.positions_get() or []
    return jsonify({"positions": [
        {
            "ticket": p.ticket,
            "symbol": p.symbol,
            "type": p.type,           # 0 = buy, 1 = sell
            "volume": p.volume,
            "price_open": p.price_open,
            "sl": p.sl,
            "tp": p.tp,
            "profit": p.profit,
        } for p in pos
    ]})


@app.route("/price")
def price():
    ensure_mt5()
    symbol = request.args.get("symbol", "").upper()
    if not symbol:
        return jsonify({"error": "symbol required"}), 400
    mt5.symbol_select(symbol, True)
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return jsonify({"error": f"no tick for {symbol}"}), 404
    return jsonify({"symbol": symbol, "bid": tick.bid, "ask": tick.ask})


@app.route("/order", methods=["POST"])
def order():
    """Market order with mandatory SL/TP — the web side enforces the
    1% daily rules; this side simply refuses orders without SL/TP."""
    ensure_mt5()
    d = request.get_json(force=True)
    symbol = str(d.get("symbol", "")).upper()
    side = d.get("side")
    lot = float(d.get("lot", 0))
    sl = float(d.get("sl", 0))
    tp = float(d.get("tp", 0))

    if not symbol or side not in ("buy", "sell") or lot <= 0:
        return jsonify({"error": "symbol/side/lot invalid"}), 400
    if sl <= 0 or tp <= 0:
        return jsonify({"error": "SL and TP are mandatory on this desk"}), 400

    mt5.symbol_select(symbol, True)
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return jsonify({"error": f"no tick for {symbol}"}), 404

    request_dict = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot,
        "type": mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL,
        "price": tick.ask if side == "buy" else tick.bid,
        "sl": sl,
        "tp": tp,
        "deviation": 20,
        "magic": 777001,
        "comment": str(d.get("comment", "GembelTM"))[:26],
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    result = mt5.order_send(request_dict)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        code = getattr(result, "retcode", "?")
        comment = getattr(result, "comment", "order_send failed")
        return jsonify({"error": f"[{code}] {comment}"}), 500
    return jsonify({"ok": True, "order": result.order, "price": result.price})


@app.route("/close_all", methods=["POST"])
def close_all():
    """Force-close every open position (used on 1% breach)."""
    ensure_mt5()
    closed, errors = [], []
    for p in (mt5.positions_get() or []):
        tick = mt5.symbol_info_tick(p.symbol)
        if tick is None:
            errors.append({"ticket": p.ticket, "error": "no tick"})
            continue
        result = mt5.order_send({
            "action": mt5.TRADE_ACTION_DEAL,
            "position": p.ticket,
            "symbol": p.symbol,
            "volume": p.volume,
            "type": mt5.ORDER_TYPE_SELL if p.type == 0 else mt5.ORDER_TYPE_BUY,
            "price": tick.bid if p.type == 0 else tick.ask,
            "deviation": 30,
            "magic": 777001,
            "comment": "TM force close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        })
        if result and result.retcode == mt5.TRADE_RETCODE_DONE:
            closed.append(p.ticket)
        else:
            errors.append({"ticket": p.ticket,
                           "error": getattr(result, "comment", "failed")})
    return jsonify({"ok": not errors, "closed": closed, "errors": errors})


if __name__ == "__main__":
    print("MT5 bridge listening on http://127.0.0.1:5000")
    if not MT5_AVAILABLE:
        print("WARNING: MetaTrader5 package missing — /health works, trading endpoints will error.")
    app.run(host="127.0.0.1", port=5000)
