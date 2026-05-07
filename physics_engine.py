import numpy as np
from scipy.integrate import solve_ivp

def damped_oscillator(t, y, m, c, k):
    x, v = y
    return [v, -(c / m) * v - (k / m) * x]

def calculate_oscillation(m, c, k, x0, t_max=20.0, num_points=500):
    t_span = (0, t_max)
    t_eval = np.linspace(0, t_max, num_points)
    sol = solve_ivp(damped_oscillator, t_span, [x0, 0.0], args=(m, c, k), t_eval=t_eval, method='RK45')
    return {"t": sol.t.tolist(), "x": sol.y[0].tolist()}

def calculate_all_damping(m, k, x0, t_max=20.0):
    """Calculates all 4 conditions for the comparison graph."""
    c_critical = 2 * np.sqrt(m * k)
    conditions = {
        "Tanpa Redaman": 0.0,
        "Underdamped": c_critical * 0.2, # 20% of critical
        "Critically Damped": c_critical,
        "Overdamped": c_critical * 2.5   # 250% of critical
    }
    
    results = {}
    for name, c_val in conditions.items():
        results[name] = calculate_oscillation(m, c_val, k, x0, t_max)
    return results