import numpy as np
from scipy.integrate import solve_ivp


# ─── ODE ──────────────────────────────────────────────────────────────────────
def damped_oscillator(t, y, m, c, k):
    x, v = y
    return [v, -(c / m) * v - (k / m) * x]


# ─── Damping classifier ────────────────────────────────────────────────────────
def classify_damping(m: float, c: float, k: float) -> dict:
    if k <= 0 or m <= 0:
        return {"zeta": 0.0, "category": "Invalid", "c_critical": 0.0}
    c_critical = 2.0 * np.sqrt(m * k)
    zeta = c / c_critical if c_critical > 0 else 0.0
    # Tolerance note: the frontend's "Critically Damped" preset sends
    # c = c_critical.toFixed(3), so zeta comes back as ~1.00008 rather
    # than exactly 1.0. 1e-9 was far too tight and misclassified that
    # as "Overdamped"; 1e-3 comfortably absorbs the rounding while still
    # being far smaller than the 20%/250% gaps to the under/over presets.
    if c == 0:
        category = "Undamped"
    elif zeta < 1.0 - 1e-3:
        category = "Underdamped"
    elif abs(zeta - 1.0) < 1e-3:
        category = "Critically Damped"
    else:
        category = "Overdamped"
    return {"zeta": round(zeta, 4), "category": category, "c_critical": round(c_critical, 4)}


# ─── Core solver ──────────────────────────────────────────────────────────────
def calculate_oscillation(m: float, c: float, k: float, x0: float,
                           v0: float = 0.0, t_max: float = 20.0,
                           num_points: int = 600) -> dict:
    t_span = (0, t_max)
    t_eval = np.linspace(0, t_max, num_points)
    sol = solve_ivp(
        damped_oscillator, t_span, [x0, v0],
        args=(m, c, k), t_eval=t_eval, method="RK45",
        rtol=1e-6, atol=1e-9
    )
    info = classify_damping(m, c, k)
    return {
        "t": sol.t.tolist(),
        "x": sol.y[0].tolist(),
        "v": sol.y[1].tolist(),
        "zeta": info["zeta"],
        "category": info["category"],
        "c_critical": info["c_critical"],
    }


# ─── Comparison (all 4 regimes) ───────────────────────────────────────────────
def calculate_all_damping(m: float, k: float, x0: float,
                           v0: float = 0.0, t_max: float = 20.0) -> dict:
    c_critical = 2.0 * np.sqrt(m * k)
    conditions = {
        "Tanpa Redaman":    0.0,
        "Underdamped":      c_critical * 0.2,
        "Critically Damped": c_critical,
        "Overdamped":       c_critical * 2.5,
    }
    return {
        name: calculate_oscillation(m, c_val, k, x0, v0, t_max)
        for name, c_val in conditions.items()
    }


# ─── Smart Solver ─────────────────────────────────────────────────────────────
def smart_solver(solver_type: str, params: dict) -> dict:
    """
    Returns step-by-step LaTeX explanation + final answer.
    solver_type: "position" | "critical_c" | "spring_constant"
    """
    if solver_type == "position":
        return _solve_position(params)
    elif solver_type == "critical_c":
        return _solve_critical_c(params)
    elif solver_type == "spring_constant":
        return _solve_spring_constant(params)
    return {"error": "Unknown solver type"}


def _solve_position(p: dict) -> dict:
    m  = float(p.get("m", 1))
    c  = float(p.get("c", 0))
    k  = float(p.get("k", 10))
    x0 = float(p.get("x0", 1))
    v0 = float(p.get("v0", 0))
    t  = float(p.get("t", 1))

    c_crit = 2.0 * np.sqrt(m * k)
    zeta   = c / c_crit if c_crit > 0 else 0.0
    omega_n = np.sqrt(k / m)
    omega_d = omega_n * np.sqrt(max(1 - zeta**2, 0))

    sol = solve_ivp(
        damped_oscillator, (0, t), [x0, v0],
        args=(m, c, k), t_eval=[t], method="RK45"
    )
    x_val = float(sol.y[0][-1])
    v_val = float(sol.y[1][-1])

    steps = [
        r"**Persamaan gerak:** $m\ddot{x} + c\dot{x} + kx = 0$",
        rf"**Parameter:** $m={m}\ \text{{kg}},\ c={c}\ \text{{N·s/m}},\ k={k}\ \text{{N/m}}$",
        rf"**Kondisi awal:** $x_0={x0}\ \text{{m}},\ v_0={v0}\ \text{{m/s}}$",
        rf"**Frekuensi natural:** $\omega_n = \sqrt{{k/m}} = \sqrt{{{k}/{m}}} = {omega_n:.4f}\ \text{{rad/s}}$",
        rf"**Damping kritis:** $c_c = 2\sqrt{{mk}} = 2\sqrt{{{m}\cdot{k}}} = {c_crit:.4f}\ \text{{N·s/m}}$",
        rf"**Rasio redaman:** $\zeta = \dfrac{{c}}{{c_c}} = \dfrac{{{c}}}{{{c_crit:.4f}}} = {zeta:.4f}$",
        rf"**Kategori:** {classify_damping(m, c, k)['category']}",
        rf"**Frekuensi teredam:** $\omega_d = \omega_n\sqrt{{1-\zeta^2}} = {omega_d:.4f}\ \text{{rad/s}}$",
        r"**Solusi dihitung numerik via RK45 (scipy.integrate.solve_ivp)**",
        rf"**Hasil pada $t={t}$ s:**",
        rf"$$x({t}) = {x_val:.6f}\ \text{{m}}$$",
        rf"$$\dot{{x}}({t}) = {v_val:.6f}\ \text{{m/s}}$$",
    ]
    return {"steps": steps, "answer": f"x({t}) = {x_val:.6f} m", "answer_v": f"v({t}) = {v_val:.6f} m/s"}


def _solve_critical_c(p: dict) -> dict:
    m = float(p.get("m", 1))
    k = float(p.get("k", 10))
    c_crit = 2.0 * np.sqrt(m * k)
    omega_n = np.sqrt(k / m)

    steps = [
        rf"**Diberikan:** $m={m}\ \text{{kg}},\ k={k}\ \text{{N/m}}$",
        rf"**Frekuensi natural:** $\omega_n = \sqrt{{\dfrac{{k}}{{m}}}} = \sqrt{{\dfrac{{{k}}}{{{m}}}}} = {omega_n:.4f}\ \text{{rad/s}}$",
        r"**Rumus damping kritis:**",
        r"$$c_c = 2\sqrt{mk} = 2m\omega_n$$",
        rf"$$c_c = 2\sqrt{{{m} \times {k}}} = 2 \times {np.sqrt(m*k):.4f}$$",
        rf"$$\boxed{{c_c = {c_crit:.4f}\ \text{{N·s/m}}}}$$",
        r"**Interpretasi:**",
        rf"- Jika $c < {c_crit:.4f}$ → **Underdamped** (berosilasi)",
        rf"- Jika $c = {c_crit:.4f}$ → **Critically Damped** (paling cepat kembali)",
        rf"- Jika $c > {c_crit:.4f}$ → **Overdamped** (lambat kembali)",
    ]
    return {"steps": steps, "answer": f"c_critical = {c_crit:.4f} N·s/m"}


def _solve_spring_constant(p: dict) -> dict:
    mode = p.get("solve_for", "k")  # "k" or "m"
    omega_n = float(p.get("omega_n", 1))

    if mode == "k":
        m = float(p.get("m", 1))
        k = m * omega_n**2
        steps = [
            rf"**Diberikan:** $m={m}\ \text{{kg}},\ \omega_n={omega_n}\ \text{{rad/s}}$",
            r"**Dari definisi frekuensi natural:**",
            r"$$\omega_n = \sqrt{\frac{k}{m}} \implies k = m\omega_n^2$$",
            rf"$$k = {m} \times ({omega_n})^2 = {m} \times {omega_n**2}$$",
            rf"$$\boxed{{k = {k:.4f}\ \text{{N/m}}}}$$",
        ]
        return {"steps": steps, "answer": f"k = {k:.4f} N/m"}
    else:
        k = float(p.get("k", 10))
        m = k / omega_n**2
        steps = [
            rf"**Diberikan:** $k={k}\ \text{{N/m}},\ \omega_n={omega_n}\ \text{{rad/s}}$",
            r"**Dari definisi frekuensi natural:**",
            r"$$\omega_n = \sqrt{\frac{k}{m}} \implies m = \frac{k}{\omega_n^2}$$",
            rf"$$m = \dfrac{{{k}}}{{({omega_n})^2}} = \dfrac{{{k}}}{{{omega_n**2}}}$$",
            rf"$$\boxed{{m = {m:.4f}\ \text{{kg}}}}$$",
        ]
        return {"steps": steps, "answer": f"m = {m:.4f} kg"}