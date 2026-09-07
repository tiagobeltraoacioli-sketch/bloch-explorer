// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Bloch sphere, live — the explorer's counterpart to the wallet's globe.
//
// A wireframe sphere turning slowly, with one state vector precessing around
// it. Drawn on a <canvas> with plain 2D calls so it looks identical everywhere,
// sized by CSS, coloured from the design tokens on the element it is mounted
// in, and honest about motion: under prefers-reduced-motion it draws one
// frame and stops, and it does not animate while the tab is hidden.
import { useEffect, useRef } from "react";

const TAU = Math.PI * 2;

function readColors(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    brass: v("--brass", "#3ddc9f"),
    bright: v("--brass-bright", "#7af0c1"),
    line: v("--line-strong", "rgba(233,246,240,.16)"),
    faint: v("--faint", "#66807a"),
    fg: v("--fg", "#eef5f2"),
  };
}

export function BlochSphere({ size = 180, className }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    let colors = readColors(canvas);
    let frames = 0;

    const draw = (t: number) => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const px = size * dpr;
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      if (frames++ % 60 === 0) colors = readColors(canvas);
      const c = px / 2;
      const R = px * 0.42;
      const rotY = (t / 36000) * TAU; // one turn in 36 s
      const tilt = 0.42;

      ctx.clearRect(0, 0, px, px);
      ctx.lineWidth = Math.max(1, dpr * 0.9);

      // atmosphere
      const g = ctx.createRadialGradient(c, c, R * 0.2, c, c, R * 1.25);
      g.addColorStop(0, "rgba(61,220,159,0.10)");
      g.addColorStop(1, "rgba(61,220,159,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, R * 1.25, 0, TAU);
      ctx.fill();

      // project a point on the unit sphere
      const proj = (x: number, y: number, z: number) => {
        const x1 = x * Math.cos(rotY) + z * Math.sin(rotY);
        const z1 = -x * Math.sin(rotY) + z * Math.cos(rotY);
        const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
        return { X: c + x1 * R, Y: c - y2 * R, depth: z2 };
      };

      const strokeCircle = (pts: { X: number; Y: number; depth: number }[], front: boolean) => {
        ctx.beginPath();
        let open = false;
        for (const p of pts) {
          const visible = front ? p.depth >= -0.02 : p.depth < -0.02;
          if (!visible) {
            open = false;
            continue;
          }
          if (!open) {
            ctx.moveTo(p.X, p.Y);
            open = true;
          } else ctx.lineTo(p.X, p.Y);
        }
        ctx.stroke();
      };

      // graticule: equator, two meridians, two latitude rings
      const rings: { X: number; Y: number; depth: number }[][] = [];
      const N = 96;
      const ring = (f: (a: number) => [number, number, number]) =>
        Array.from({ length: N + 1 }, (_, i) => {
          const [x, y, z] = f((i / N) * TAU);
          return proj(x, y, z);
        });
      rings.push(ring((a) => [Math.cos(a), 0, Math.sin(a)]));
      for (const lat of [0.5, -0.5]) {
        const r = Math.sqrt(1 - lat * lat);
        rings.push(ring((a) => [r * Math.cos(a), lat, r * Math.sin(a)]));
      }
      for (const m of [0, Math.PI / 2]) {
        rings.push(ring((a) => [Math.cos(a) * Math.cos(m), Math.sin(a), Math.cos(a) * Math.sin(m)]));
      }
      ctx.strokeStyle = colors.line;
      ctx.globalAlpha = 0.55;
      for (const r of rings) strokeCircle(r, false);
      ctx.globalAlpha = 1;
      for (const r of rings) strokeCircle(r, true);

      // rim
      ctx.beginPath();
      ctx.arc(c, c, R, 0, TAU);
      ctx.strokeStyle = colors.brass;
      ctx.globalAlpha = 0.75;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // the state vector, precessing about the z axis at a fixed polar angle
      const theta = 0.95 + 0.12 * Math.sin(t / 9000);
      const phi = (t / 5200) * TAU;
      const sx = Math.sin(theta) * Math.cos(phi);
      const sy = Math.cos(theta);
      const sz = Math.sin(theta) * Math.sin(phi);
      const tip = proj(sx, sy, sz);
      const shadow = proj(sx, 0, sz); // its footprint on the equatorial plane

      ctx.setLineDash([dpr * 2, dpr * 3]);
      ctx.strokeStyle = colors.faint;
      ctx.beginPath();
      ctx.moveTo(tip.X, tip.Y);
      ctx.lineTo(shadow.X, shadow.Y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = colors.fg;
      ctx.lineWidth = dpr * 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(tip.X, tip.Y);
      ctx.stroke();

      ctx.fillStyle = colors.bright;
      ctx.shadowColor = colors.brass;
      ctx.shadowBlur = dpr * 8;
      ctx.beginPath();
      ctx.arc(tip.X, tip.Y, dpr * 3.4, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = colors.faint;
      ctx.beginPath();
      ctx.arc(c, c, dpr * 1.6, 0, TAU);
      ctx.fill();
    };

    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced) {
        draw(12_000);
        return;
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [size]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: size, height: size, display: "block" }}
      aria-hidden="true"
    />
  );
}
