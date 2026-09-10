# FloatingOrigin3D — 64-Bit Large World Coordinates & Seamless Origin Shifting for GDevelop

**FloatingOrigin3D** is a precision coordinate management engine for **GDevelop 5 (Three.js WebGL2 / Jolt Physics backend)**.

---

## 🌟 Key Highlights

- **Eliminates 32-Bit Float Jitter:** Standard WebGL2 32-bit floats lose precision beyond $2\text{km}$, causing character models, props, and physics colliders to violently shake. **FloatingOrigin3D** keeps true positions in 64-bit double precision (`float64`).
- **Atomic Scene & Jolt Physics Re-Centering:** When the player moves farther than a set threshold (e.g. $1,000\text{m}$), the entire Three.js world and Jolt 3D Physics simulation bodies are shifted by $-\Delta \vec{O}$ in a single atomic frame with **zero hitching or visual glitching**.
- **Infinite Open-World Range:** Enables $50\text{km} \times 50\text{km}+$ open worlds, space flight simulators, and planetary scale games in GDevelop with sub-millimeter vertex stability.

---

## 📚 Documentation

- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — Technical architecture, 64-bit float math, and Jolt physics origin shifting.
- [API_REFERENCE.md](./API_REFERENCE.md) — Properties, Actions, Conditions, and Expressions.
