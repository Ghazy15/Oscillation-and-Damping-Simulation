import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from physics_engine import (
    calculate_oscillation,
    calculate_all_damping,
    classify_damping,
    smart_solver,
)

app = FastAPI()
app.mount("/static", StaticFiles(directory="static", html=True), name="static")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Send initial state on connect
    init_data = calculate_oscillation(1.0, 0.5, 10.0, 5.0, v0=0.0, t_max=20.0)
    await websocket.send_text(json.dumps({"mode": "single", "data": init_data}))

    try:
        while True:
            raw = await websocket.receive_text()
            params = json.loads(raw)
            mode = params.get("mode", "single")

            m   = float(params.get("m",    1.0))
            k   = float(params.get("k",    10.0))
            x0  = float(params.get("x0",   5.0))
            v0  = float(params.get("v0",   0.0))
            t_max = float(params.get("t_max", 20.0))

            if mode == "compare":
                data = calculate_all_damping(m, k, x0, v0, t_max)
                await websocket.send_text(json.dumps({"mode": "compare", "data": data}))

            elif mode == "single":
                c = float(params.get("c", 0.5))
                data = calculate_oscillation(m, c, k, x0, v0, t_max)
                await websocket.send_text(json.dumps({"mode": "single", "data": data}))

            elif mode == "classify":
                c = float(params.get("c", 0.5))
                info = classify_damping(m, c, k)
                await websocket.send_text(json.dumps({"mode": "classify", "data": info}))

            elif mode == "smart_solver":
                solver_type = params.get("solver_type", "position")
                result = smart_solver(solver_type, params)
                await websocket.send_text(json.dumps({"mode": "smart_solver", "data": result}))

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"WS Error: {e}")