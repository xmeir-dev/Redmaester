"use client";

import { useEffect, useRef } from "react";

// ── Grid ──
const CW = 8, CH = 12, FONT = 10, COLS = 44, ROWS = 36;
const W = COLS * CW, H = ROWS * CH;
const CR = 192, CG = 57, CB = 43; // #c0392b

// ── Math ──
function fract(x: number) { return x - Math.floor(x); }
function cellHash(c: number, r: number) { return fract(Math.sin(c * 127.1 + r * 311.7) * 43758.5453); }
function ss(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function cl(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }

// ── SDF ──
function C(px: number, py: number, cx: number, cy: number, r: number) {
  return Math.hypot(px - cx, py - cy) - r;
}
function RB(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number) {
  const dx = Math.abs(px - cx) - hw + r, dy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
function B(px: number, py: number, cx: number, cy: number, hw: number, hh: number) {
  const dx = Math.abs(px - cx) - hw, dy = Math.abs(py - cy) - hh;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
function S(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const dot = bax * bax + bay * bay;
  const h = dot > 0 ? cl((pax * bax + pay * bay) / dot, 0, 1) : 0;
  return Math.hypot(pax - bax * h, pay - bay * h);
}
function U(...a: number[]) { return Math.min(...a); }
function bri(d: number) { return ss(3, -3, d); }

// ── Scale factor: shape designed at 256px, canvas is now W px ──
const SX = W / 256;
const SY = H / 312;

// ── Left-facing armchair (scaled) ──
function chairLeft(px: number, py: number) {
  const qx = px / SX, qy = py / SY; // map back to design coords
  const dw = 256; // design width
  let d = RB(qx, qy, dw - 52, 106, 16, 68, 10);
  d = U(d, RB(qx, qy, dw - 110, 176, 64, 10, 5));
  d = U(d, RB(qx, qy, dw - 168, 140, 10, 30, 5));
  d = U(d, S(qx, qy, dw - 44, 186, dw - 40, 280) - 5);
  d = U(d, S(qx, qy, dw - 168, 186, dw - 172, 280) - 5);
  d = U(d, B(qx, qy, dw - 128, 290, 110, 2));
  return d;
}

// ── Shape #18: Knees Up (left-facing, scaled) ──
function kneesUpReader(px: number, py: number) {
  const qx = px / SX, qy = py / SY;
  const mx = 256; // design width
  let d = chairLeft(px, py);
  // Head
  d = U(d, C(qx, qy, mx - 104, 42, 20));
  d = U(d, C(qx, qy, mx - 124, 44, 6));
  // Neck
  d = U(d, S(qx, qy, mx - 102, 62, mx - 94, 76) - 7);
  // Torso (slightly reclined)
  d = U(d, RB(qx, qy, mx - 88, 120, 20, 42, 6));
  // Arms forward, resting book on knees
  d = U(d, S(qx, qy, mx - 104, 84, mx - 118, 114) - 7);
  d = U(d, S(qx, qy, mx - 118, 114, mx - 138, 102) - 6.5);
  // Book propped on knees
  d = U(d, RB(qx, qy, mx - 142, 86, 10, 20, 2));
  // Upper legs going UP (knees raised)
  d = U(d, S(qx, qy, mx - 96, 158, mx - 128, 108) - 11);
  // Lower legs tucked back down to seat
  d = U(d, S(qx, qy, mx - 128, 108, mx - 140, 168) - 8.5);
  // Feet on seat
  d = U(d, RB(qx, qy, mx - 144, 174, 12, 6, 3));
  return bri(d);
}

// ── Dissolve Canvas (no scanlines) ──
export function ReaderCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const shapeB = new Float32Array(COLS * ROWS);
    const hashes = new Float32Array(COLS * ROWS);
    const chars: string[] = new Array(COLS * ROWS);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        shapeB[i] = kneesUpReader(c * CW + CW / 2, r * CH + CH / 2);
        hashes[i] = cellHash(c, r);
        chars[i] = fract(Math.sin(c * 269.5 + r * 183.3) * 43758.5453) > 0.5 ? "1" : "0";
      }
    }

    let frame = 0;
    let rafId: number;

    function render() {
      frame++;
      const t = frame * 0.02;
      const phase = (Math.sin(t * 0.5) + 1) / 2;

      ctx.clearRect(0, 0, W, H);
      ctx.font = `${FONT}px "Space Mono", monospace`;
      ctx.textBaseline = "top";

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const i = r * COLS + c;
          const b = shapeB[i];
          const nx = c / COLS;
          const ny = r / ROWS;

          if (b > 0.1) {
            const h = hashes[i];
            const spatial = Math.sin(nx * 3 + ny * 2 + t * 0.8) * 0.15;
            const threshold = phase + spatial;

            if (h < threshold) {
              let a = b;
              if (threshold - h < 0.05) a = Math.min(a * 1.4, 1);
              ctx.fillStyle = `rgba(${CR},${CG},${CB},${a})`;
              ctx.fillText(chars[i], c * CW, r * CH + 1);
            } else {
              const df = ss(0, 0.25, h - threshold);
              const drift = df * 50;
              const offX = (nx - 0.5) * drift * 2;
              const offY = (ny - 0.5) * drift * 2;
              let a = b * (1 - df * 0.85);
              if (h - threshold < 0.05) a = Math.min(a * 1.6, 1);
              if (a > 0.02) {
                const dx = c * CW + offX;
                const dy = r * CH + 1 + offY;
                if (dx > -CW && dx < W + CW && dy > -CH && dy < H + CH) {
                  ctx.fillStyle = `rgba(${CR},${CG},${CB},${a})`;
                  ctx.fillText(chars[i], dx, dy);
                }
              }
            }
          } else if (Math.random() < 0.008) {
            ctx.fillStyle = `rgba(${CR},${CG},${CB},${0.05 + Math.random() * 0.03})`;
            ctx.fillText(Math.random() > 0.5 ? "1" : "0", c * CW, r * CH + 1);
          }
        }
      }

      rafId = requestAnimationFrame(render);
    }

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return <canvas ref={ref} className="block" />;
}
