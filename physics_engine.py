"""
physics_engine.py

Core physics solver for a 1-DOF mass-spring-damper system.

Equation of motion (2nd-order ODE):
    m * x''(t) + c * x'(t) + k * x(x) = 0

State vector:
    y = [x, v]
    y' = [v, -(c/m)*v - (k/m)*x]

This module exposes a single public function:
    solve_mass_spring(params: dict) -> dict

It uses scipy.integrate.solve_ivp with RK45 and returns pre-computed
arrays of time and displacement suitable for real-time visualization.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any

import numpy as np
from scipy.integrate import solve_ivp


@dataclass
class MassSpringParams:
    """
    Parameters for the mass-spring-damper system.

    Units (SI):
        m : mass (kg)
        k : spring constant (N/m)
        c : damping coefficient (N·s/m)
        x0: initial displacement (m)
        v0: initial velocity (m/s)
        duration: simulation duration (s)
        max_step: maximum solver step size (s)
    """
    m: float
    k: float
    c: float
    x0: float
    v0: float
    duration: float
    max_step: float = 0.016  # ~60 Hz friendly default

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MassSpringParams":
        """
        Build params from a dictionary (e.g., WebSocket JSON payload).
        Missing keys use sensible defaults.
        """
        return cls(
            m=float(data.get("m", 1.0)),
            k=float(data.get("k", 10.0)),
            c=float(data.get("c", 0.0)),
            x0=float(data.get("x0", 0.1)),
            v0=float(data.get("v0", 0.0)),
            duration=float(data.get("duration", 10.0)),
            max_step=float(data.get("max_step", 0.016)),
        )


def _system_ode(t: float, y: np.ndarray, m: float, c: float, k: float) -> np.ndarray:
    """
    First-order form of m*x'' + c*x' + k*x = 0.

    Args:
        t: time (unused, required by solve_ivp signature)
        y: [x, v]
        m, c, k: system parameters

    Returns:
        dy/dt = [v, -(c/m)*v - (k/m)*x]
    """
    x, v = y
    dxdt = v
    dvdt = -(c / m) * v - (k / m) * x
    return np.array([dxdt, dvdt], dtype=np.float64)


def solve_mass_spring(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Solve the mass-spring-damper ODE and return time/displacement arrays.

    Args:
        params: dict with keys:
            m, k, c, x0, v0, duration, max_step (optional)

    Returns:
        dict with:
            ok: bool
            error: str | None
            t: list[float]  (time points)
            x: list[float]  (displacement points)
            metadata: dict  (damping type, omega_n, zeta, etc.)
    """
    try:
        p = MassSpringParams.from_dict(params)

        # Basic validation
        if p.m <= 0:
            raise ValueError("Mass m must be > 0.")
        if p.k <= 0:
            raise ValueError("Spring constant k must be > 0.")
        if p.c < 0:
            raise ValueError("Damping coefficient c must be >= 0.")
        if p.duration <= 0:
            raise ValueError("Duration must be > 0.")
        if p.max_step <= 0:
            raise ValueError("max_step must be > 0.")

        # Natural frequency and damping ratio
        omega_n = np.sqrt(p.k / p.m)
        zeta = p.c / (2.0 * np.sqrt(p.k * p.m))

        # Classify damping
        if np.isclose(zeta, 1.0, atol=1e-8):
            damping_type = "critically_damped"
        elif zeta < 1.0:
            damping_type = "underdamped"
        else:
            damping_type = "overdamped"

        # Undamped reference (c=0) for comparison metadata
        omega_d = omega_n * np.sqrt(1.0 - zeta ** 2) if zeta < 1.0 else 0.0

        y0 = np.array([p.x0, p.v0], dtype=np.float64)

        # Dense output enabled for smooth interpolation if needed downstream.
        # We explicitly request evaluation at evenly spaced points via `t_eval`.
        num_points = max(2, int(np.ceil(p.duration / p.max_step)) + 1)
        t_eval = np.linspace(0.0, p.duration, num_points)

        sol = solve_ivp(
            fun=_system_ode,
            t_span=(0.0, p.duration),
            y0=y0,
            method="RK45",
            t_eval=t_eval,
            max_step=p.max_step,
            args=(p.m, p.c, p.k),
            rtol=1e-8,
            atol=1e-10,
        )

        if not sol.success:
            return {
                "ok": False,
                "error": f"Solver failed: {sol.message}",
                "t": [],
                "x": [],
                "metadata": {},
            }

        # Extract displacement (x) and time arrays
        t_arr = sol.t.tolist()
        x_arr = sol.y[0].tolist()

        return {
            "ok": True,
            "error": None,
            "t": t_arr,
            "x": x_arr,
            "metadata": {
                "m": p.m,
                "k": p.k,
                "c": p.c,
                "x0": p.x0,
                "v0": p.v0,
                "duration": p.duration,
                "omega_n": omega_n,
                "zeta": zeta,
                "damping_type": damping_type,
                "omega_d": omega_d,
            },
        }

    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "t": [],
            "x": [],
            "metadata": {},
        }
