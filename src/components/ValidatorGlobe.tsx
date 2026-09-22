// SPDX-License-Identifier: AGPL-3.0-or-later
// Interactive validator globe, ported from the canonical Postern Labs sphere.
// Each Fibonacci-lattice point is one live registry index and opens its detail
// page. Canvas keeps the animation small; DOM text preserves accessibility.
import { useEffect, useRef } from "react";
import { useRouter } from "../lib/router";

interface Point { index: number; x: number; y: number; z: number }
interface Projected { index: number; x: number; y: number; z: number }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function palette(canvas: HTMLCanvasElement) {
  const css = getComputedStyle(canvas);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    accent: color("--brass-bright", "#d6ff96"),
    ink: color("--fg", "#f2f0e7"),
    info: color("--info", "#a98cff"),
    line: color("--line-strong", "rgba(242,240,231,.16)"),
    background: color("--bg1", "#161916"),
  };
}

export function ValidatorGlobe({ total, active }: { total: number; active: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const { navigate } = useRouter();
  const count = Number.isInteger(total) && total > 0 && total <= 4096 ? total : 140;

  useEffect(() => {
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !tooltip) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const points: Point[] = Array.from({ length: count }, (_, index) => {
      const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * index;
      return { index, x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
    });
    let projected: Projected[] = [];
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let angle = 0;
    let hovered: number | null = null;
    let keyboardIndex: number | null = null;
    let pointerInside = false;
    let raf = 0;

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(220, Math.round(canvas.clientWidth || 520));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(width * dpr);
    };
    const draw = () => {
      const width = canvas.width, height = canvas.height;
      const radius = Math.min(width, height) * .39, cx = width / 2, cy = height / 2;
      const colors = palette(canvas);
      const ca = Math.cos(angle), sa = Math.sin(angle), tilt = -.42;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      ctx.clearRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(cx, cy, radius * .1, cx, cy, radius * 1.3);
      glow.addColorStop(0, "rgba(130,180,238,.09)"); glow.addColorStop(1, "rgba(130,180,238,0)");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, radius * 1.3, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = colors.line; ctx.lineWidth = dpr;
      for (const latitude of [-.5, 0, .5]) {
        const ringRadius = Math.sqrt(1 - latitude * latitude);
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const a = i / 96 * Math.PI * 2, x = Math.cos(a) * ringRadius, z = Math.sin(a) * ringRadius;
          const x2 = x * ca - z * sa, z2 = x * sa + z * ca;
          const px = cx + x2 * radius, py = cy + (latitude * ct - z2 * st) * radius;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }

      projected = points.map((point) => {
        const x2 = point.x * ca - point.z * sa, z2 = point.x * sa + point.z * ca;
        const y2 = point.y * ct - z2 * st, z3 = point.y * st + z2 * ct;
        return { index: point.index, x: cx + x2 * radius, y: cy + y2 * radius, z: z3 };
      }).sort((a, b) => a.z - b.z);

      for (const point of projected) {
        const depth = (point.z + 1) / 2;
        const selected = point.index === hovered || point.index === keyboardIndex;
        const isActive = active === null || point.index < active;
        ctx.globalAlpha = selected ? 1 : (isActive ? .22 + depth * .75 : .12 + depth * .25);
        ctx.fillStyle = !isActive ? colors.line : depth > .82 ? colors.info : colors.accent;
        if (selected) {
          ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.4 * dpr;
          ctx.beginPath(); ctx.arc(point.x, point.y, 9 * dpr, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(point.x, point.y, (selected ? 4.2 : 1.3 + depth * 1.9) * dpr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    };
    const nearest = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * dpr, y = (event.clientY - rect.top) * dpr;
      let match: Projected | null = null, distance = (16 * dpr) ** 2;
      for (const point of projected) {
        const next = (point.x - x) ** 2 + (point.y - y) ** 2;
        if (next < distance) { distance = next; match = point; }
      }
      return match;
    };
    const showTooltip = (point: Projected | undefined | null) => {
      if (!point) { tooltip.hidden = true; return; }
      tooltip.textContent = `Validator v${point.index} · ${active === null ? "registry entry" : point.index < active ? "active" : "not active"}`;
      tooltip.style.left = `${point.x / dpr}px`; tooltip.style.top = `${point.y / dpr}px`; tooltip.hidden = false;
      canvas.setAttribute("aria-label", `Validator globe. Selected validator ${point.index} of ${count - 1}. Press Enter to open.`);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const point = nearest(event); hovered = point?.index ?? null;
      canvas.style.cursor = point ? "pointer" : "grab"; showTooltip(point); draw();
    };
    const onClick = (event: PointerEvent) => { const point = nearest(event); if (point) navigate(`/validators/${point.index}`); };
    const onEnter = () => { pointerInside = true; };
    const onLeave = () => { pointerInside = false; hovered = null; tooltip.hidden = true; draw(); };
    const onFocus = () => { keyboardIndex = keyboardIndex ?? 0; showTooltip(projected.find((p) => p.index === keyboardIndex)); draw(); };
    const onBlur = () => { keyboardIndex = null; tooltip.hidden = true; draw(); };
    const onKey = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") { navigate(`/validators/${keyboardIndex ?? 0}`); return; }
      const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      keyboardIndex = ((keyboardIndex ?? 0) + direction + count) % count;
      showTooltip(projected.find((point) => point.index === keyboardIndex)); draw();
    };
    const frame = () => { if (!pointerInside && keyboardIndex === null) angle += .0022; draw(); raf = requestAnimationFrame(frame); };
    const start = () => { if (!reduced && !raf) raf = requestAnimationFrame(frame); else draw(); };
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
    const onVisibility = () => document.hidden ? stop() : start();
    const resize = new ResizeObserver(() => { size(); draw(); });
    const theme = new MutationObserver(draw);

    size(); draw(); start(); resize.observe(canvas); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointermove", onMove); canvas.addEventListener("click", onClick);
    canvas.addEventListener("focus", onFocus);
    canvas.addEventListener("blur", onBlur);
    canvas.addEventListener("keydown", onKey); document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop(); resize.disconnect(); theme.disconnect(); document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerenter", onEnter); canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("focus", onFocus); canvas.removeEventListener("blur", onBlur); canvas.removeEventListener("keydown", onKey);
    };
  }, [active, count, navigate]);

  return <div className="validator-globe-wrap">
    <canvas ref={canvasRef} className="validator-globe" tabIndex={0} role="link" aria-label={`Interactive globe of ${count} validators. Use arrow keys to select a validator and Enter to open it.`} />
    <div ref={tooltipRef} className="validator-globe-tooltip" role="status" hidden />
  </div>;
}
