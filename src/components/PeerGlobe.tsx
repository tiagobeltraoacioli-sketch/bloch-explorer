// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from "react";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_VISIBLE_POINTS = 6000;

/** An abstract sphere: points encode connection reports, never peer locations. */
export function PeerGlobe({ connections }: { connections: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const count = connections !== null && Number.isSafeInteger(connections) && connections >= 0 ? connections : null;
  const drawn = Math.min(count ?? 0, MAX_VISIBLE_POINTS);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const points = Array.from({ length: drawn }, (_, index) => {
      const y = drawn === 1 ? 0 : 1 - (index / (drawn - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = index * GOLDEN_ANGLE;
      return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
    });
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let angle = 0;
    let frame = 0;
    let lastFrame = 0;
    let visible = false;

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(220, Math.round(canvas.clientWidth || 520));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(width * dpr);
      draw();
    };
    const draw = () => {
      const width = canvas.width;
      const cx = width / 2, cy = canvas.height / 2, radius = width * .39;
      const styles = getComputedStyle(canvas);
      const accent = styles.getPropertyValue("--info").trim() || "#a98cff";
      const bright = styles.getPropertyValue("--brass-bright").trim() || "#d6ff96";
      const line = styles.getPropertyValue("--line-strong").trim() || "rgba(242,240,231,.16)";
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const tilt = -.32, ct = Math.cos(tilt), st = Math.sin(tilt);
      ctx.clearRect(0, 0, width, canvas.height);
      const glow = ctx.createRadialGradient(cx, cy, radius * .12, cx, cy, radius * 1.28);
      glow.addColorStop(0, "rgba(169,140,255,.12)");
      glow.addColorStop(1, "rgba(169,140,255,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, radius * 1.28, 0, Math.PI * 2); ctx.fill();

      ctx.strokeStyle = line;
      ctx.lineWidth = dpr;
      for (const latitude of [-.5, 0, .5]) {
        const ring = Math.sqrt(1 - latitude * latitude);
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const a = i / 96 * Math.PI * 2;
          const x = Math.cos(a) * ring, z = Math.sin(a) * ring;
          const z2 = x * sa + z * ca;
          const px = cx + (x * ca - z * sa) * radius;
          const py = cy + (latitude * ct - z2 * st) * radius;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.stroke();
      }

      // Separate rear and front passes preserve depth without sorting thousands
      // of points on every frame. Every point is one measured connection when
      // the total is within the rendering budget.
      for (const front of [false, true]) {
        ctx.fillStyle = front ? bright : accent;
        ctx.globalAlpha = front ? .85 : .25;
        ctx.beginPath();
        for (const point of points) {
          const z2 = point.x * sa + point.z * ca;
          const depth = point.y * st + z2 * ct;
          if ((depth >= 0) !== front) continue;
          const x = cx + (point.x * ca - point.z * sa) * radius;
          const y = cy + (point.y * ct - z2 * st) * radius;
          const dot = (front ? 1.2 : .8) * dpr;
          ctx.moveTo(x + dot, y);
          ctx.arc(x, y, dot, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
    };
    const tick = (time: number) => {
      if (time - lastFrame >= 40) {
        angle += .0025;
        draw();
        lastFrame = time;
      }
      frame = requestAnimationFrame(tick);
    };
    const updateAnimation = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!reduced && visible && !document.hidden) frame = requestAnimationFrame(tick);
      else draw();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updateAnimation();
    });
    const resize = new ResizeObserver(size);
    const theme = new MutationObserver(draw);
    size();
    observer.observe(canvas);
    resize.observe(canvas);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", updateAnimation);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect(); resize.disconnect(); theme.disconnect();
      document.removeEventListener("visibilitychange", updateAnimation);
    };
  }, [drawn]);

  return <div className="peer-globe-wrap">
    <canvas ref={canvasRef} className="peer-globe" aria-hidden="true" />
    <div className="peer-globe-core" aria-hidden="true">
      <span>PEER CONNECTIONS</span>
      <strong>{count === null ? "—" : new Intl.NumberFormat("en-US").format(count)}</strong>
      <span>{count === null ? "AWAITING FRESH SAMPLE" : "REPORTED NOW"}</span>
    </div>
  </div>;
}
