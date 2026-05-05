"""
main.py

FastAPI server with WebSocket endpoint for real-time mass-spring simulation.

Endpoints:
    GET  /               -> serves a minimal HTML page (for quick testing)
    WS   /ws/simulate    -> WebSocket endpoint
        Client -> Server:
            {
                "m": 1.0,
                "k": 10.0,
                "c": 0.0,
                "x0": 0.1,
                "v0": 0.0,
                "duration": 10.0,
                "max_step": 0.016
            }

        Server -> Client:
            {
                "ok": true,
                "error": null,
                "t": [...],
                "x": [...],
                "metadata": {...}
            }
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse

from physics_engine import solve_mass_spring

app = FastAPI(
    title="Mass-Spring Real-Time Simulation API",
    description="WebSocket-driven ODE solver for 1-DOF mass-spring-damper systems.",
)


INDEX_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Mass-Spring Simulation (API Test)</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 2rem; }
  pre { background:#f5f5f5; padding:1rem; border-radius:6px; overflow:auto; }
</style>
</head>
<body>
<h1>Mass-Spring Simulation API</h1>
<p>Connect via WebSocket to <code>/ws/simulate</code> and send JSON params.</p>
<pre id="log"></pre>

<script>
  const log = document.getElementById('log');
  function add(msg) {
    log.textContent += msg + '\\n';
  }

  const ws = new WebSocket(`ws://${location.host}/ws/simulate`);
  ws.onopen = () => {
    add('WebSocket connected.');
    ws.send(JSON.stringify({ m: 1.0, k: 20.0, c: 0.5, x0: 0.15, v0: 0.0, duration: 8.0 }));
  };
  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    add('Received: ' + JSON.stringify(data, null, 2));
  };
  ws.onerror = (ev) => add('WebSocket error.');
  ws.onclose = () => add('WebSocket closed.');
</script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
async def get_index() -> HTMLResponse:
    """
    Minimal HTML page for quick manual testing.
    The real frontend (p5.js + Plotly.js) will be served separately or from static files.
    """
    return HTMLResponse(content=INDEX_HTML)


@app.websocket("/ws/simulate")
async def websocket_simulate(ws: WebSocket) -> None:
    """
    WebSocket endpoint for simulation requests.

    Expected client message format:
        {
            "m": float,
            "k": float,
            "c": float,
            "x0": float,
            "v0": float,
            "duration": float,
            "max_step": float (optional)
        }

    Server response format:
        {
            "ok": bool,
            "error": str | null,
            "t": list[float],
            "x": list[float],
            "metadata": {...}
        }
    """
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                payload: Any = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_json(
                    {
                        "ok": False,
                        "error": "Invalid JSON payload.",
                        "t": [],
                        "x": [],
                        "metadata": {},
                    }
                )
                continue

            result = solve_mass_spring(payload)
            await ws.send_json(result)

    except WebSocketDisconnect:
        # Normal disconnect
        pass
    except Exception as exc:
        # Try to notify client before closing
        try:
            await ws.send_json(
                {
                    "ok": False,
                    "error": f"Server error: {str(exc)}",
                    "t": [],
                    "x": [],
                    "metadata": {},
                }
            )
        except Exception:
            pass
    finally:
        await ws.close()
