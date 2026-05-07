import json
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from physics_engine import calculate_oscillation, calculate_all_damping

app = FastAPI()
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    # Initial load
    await websocket.send_text(json.dumps({"mode": "single", "data": calculate_oscillation(1.0, 0.5, 10.0, 5.0)}))
    
    try:
        while True:
            data = await websocket.receive_text()
            params = json.loads(data)
            
            m = float(params.get('m', 1.0))
            k = float(params.get('k', 10.0))
            x0 = float(params.get('x0', 5.0))
            mode = params.get('mode', 'single')
            
            if mode == 'compare':
                result = {"mode": "compare", "data": calculate_all_damping(m, k, x0)}
            else:
                c = float(params.get('c', 0.5))
                result = {"mode": "single", "data": calculate_oscillation(m, c, k, x0)}
                
            await websocket.send_text(json.dumps(result))
    except Exception as e:
        print(f"WS Closed: {e}")