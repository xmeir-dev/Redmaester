"use client";

import { useEffect, useRef, useState } from "react";

// ── Background renderer type ──
type BgOption = {
  label: string;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
};

// ── Shared helpers ──
function fract(x: number) { return x - Math.floor(x); }
function hash(a: number, b: number) {
  return fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);
}

const R = 192, G = 57, B2 = 43; // #c0392b

// ── 15 background options (visible alphas) ──
const backgrounds: BgOption[] = [

  // 1 — Code Rain
  { label: "Code Rain", render: (ctx, w, h, t) => {
    ctx.font = "11px 'Space Mono', monospace";
    ctx.textBaseline = "top";
    const cols = Math.floor(w / 14);
    const rows = Math.floor(h / 16);
    for (let c = 0; c < cols; c++) {
      const speed = 0.3 + hash(c, 0) * 0.4;
      const offset = hash(c, 1) * rows;
      for (let r = 0; r < rows; r++) {
        const ry = (r + t * speed + offset) % (rows + 8) - 4;
        const fade = 1 - Math.abs(ry - rows * 0.4) / (rows * 0.6);
        const alpha = Math.max(0, Math.min(0.35, fade * 0.35)) * (0.3 + hash(c, r) * 0.7);
        if (alpha > 0.01) {
          ctx.fillStyle = `rgba(${R},${G},${B2},${alpha})`;
          const ch = hash(c, r + Math.floor(t * speed * 0.2)) > 0.5 ? "1" : "0";
          ctx.fillText(ch, c * 14, ry * 16);
        }
      }
    }
  }},

  // 2 — Scan Lines
  { label: "Scan Lines", render: (ctx, w, h, t) => {
    for (let y = 0; y < h; y += 5) {
      const wave = Math.sin(y * 0.02 + t * 0.3) * 0.06;
      const alpha = 0.1 + wave;
      ctx.fillStyle = `rgba(${R},${G},${B2},${Math.max(0, alpha)})`;
      ctx.fillRect(0, y, w, 1.5);
    }
  }},

  // 3 — Static Code
  { label: "Static Code", render: (ctx, w, h) => {
    ctx.font = "10px 'Space Mono', monospace";
    ctx.textBaseline = "top";
    const keywords = ["const", "let", "async", "await", "fetch", "return", "if", "=>", "{}", "[]", "//", "...", "null", "true", "POST", "GET", "JSON", "api", "data", "res"];
    const cols = Math.floor(w / 48);
    const rows = Math.floor(h / 14);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = Math.floor(hash(c, r) * keywords.length);
        const alpha = 0.08 + hash(c + 50, r + 50) * 0.08;
        ctx.fillStyle = `rgba(${R},${G},${B2},${alpha})`;
        ctx.fillText(keywords[idx], c * 48 + (hash(c, r + 7) * 8), r * 14);
      }
    }
  }},

  // 4 — Diagonal Lines
  { label: "Diagonal Lines", render: (ctx, w, h, t) => {
    ctx.strokeStyle = `rgba(${R},${G},${B2},0.12)`;
    ctx.lineWidth = 1;
    const spacing = 18;
    const drift = (t * 0.5) % spacing;
    for (let i = -h; i < w + h; i += spacing) {
      ctx.beginPath();
      ctx.moveTo(i + drift, 0);
      ctx.lineTo(i + drift - h, h);
      ctx.stroke();
    }
  }},

  // 5 — Circuit Traces
  { label: "Circuit Traces", render: (ctx, w, h) => {
    ctx.lineWidth = 1;
    const step = 28;
    for (let y = step; y < h; y += step) {
      for (let x = step; x < w; x += step) {
        const h1 = hash(x, y);
        if (h1 > 0.5) {
          const len = 20 + hash(x + 1, y) * 44;
          ctx.strokeStyle = `rgba(${R},${G},${B2},0.12)`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + len, y);
          ctx.stroke();
        }
        if (h1 <= 0.5 && h1 > 0.2) {
          const len = 16 + hash(x, y + 1) * 36;
          ctx.strokeStyle = `rgba(${R},${G},${B2},0.1)`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + len);
          ctx.stroke();
        }
        if (h1 > 0.8) {
          ctx.fillStyle = `rgba(${R},${G},${B2},0.2)`;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }},

  // 6 — Dot Matrix
  { label: "Dot Matrix", render: (ctx, w, h, t) => {
    const spacing = 14;
    for (let y = spacing / 2; y < h; y += spacing) {
      for (let x = spacing / 2; x < w; x += spacing) {
        const pulse = Math.sin(x * 0.05 + y * 0.03 + t * 0.4) * 0.04;
        const alpha = 0.1 + pulse;
        ctx.fillStyle = `rgba(${R},${G},${B2},${Math.max(0.02, alpha)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }},

  // 7 — Binary Columns
  { label: "Binary Columns", render: (ctx, w, h) => {
    ctx.font = "9px 'Space Mono', monospace";
    ctx.textBaseline = "top";
    const colW = 10;
    const rowH = 12;
    const cols = Math.floor(w / colW);
    const rows = Math.floor(h / rowH);
    for (let c = 0; c < cols; c++) {
      if (hash(c, 500) > 0.5) continue;
      const colAlpha = 0.06 + hash(c, 999) * 0.12;
      for (let r = 0; r < rows; r++) {
        const alpha = colAlpha * (0.4 + hash(c, r) * 0.6);
        ctx.fillStyle = `rgba(${R},${G},${B2},${alpha})`;
        ctx.fillText(hash(c, r) > 0.5 ? "1" : "0", c * colW, r * rowH);
      }
    }
  }},

  // 8 — Flowing Lines
  { label: "Flowing Lines", render: (ctx, w, h, t) => {
    ctx.lineWidth = 1;
    const spacing = 16;
    for (let y = spacing; y < h; y += spacing) {
      const alpha = 0.1 + Math.sin(y * 0.04) * 0.04;
      ctx.strokeStyle = `rgba(${R},${G},${B2},${Math.max(0.02, alpha)})`;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const dy = Math.sin(x * 0.015 + t * 0.3 + y * 0.1) * 5;
        if (x === 0) ctx.moveTo(x, y + dy);
        else ctx.lineTo(x, y + dy);
      }
      ctx.stroke();
    }
  }},

  // 9 — Code Blocks
  { label: "Code Blocks", render: (ctx, w, h) => {
    ctx.lineWidth = 1;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const x = hash(i, 0) * (w - 80) + 10;
      const y = hash(i, 1) * (h - 40) + 5;
      const bw = 40 + hash(i, 2) * 120;
      const bh = 12 + hash(i, 3) * 36;
      ctx.strokeStyle = `rgba(${R},${G},${B2},0.1)`;
      ctx.strokeRect(x, y, bw, bh);
      for (let line = 0; line < Math.floor(bh / 8); line++) {
        const lw = 10 + hash(i, line + 10) * (bw - 20);
        ctx.fillStyle = `rgba(${R},${G},${B2},0.07)`;
        ctx.fillRect(x + 4, y + 4 + line * 8, lw, 3);
      }
    }
  }},

  // 10 — Crosshatch
  { label: "Crosshatch", render: (ctx, w, h) => {
    ctx.strokeStyle = `rgba(${R},${G},${B2},0.08)`;
    ctx.lineWidth = 1;
    const spacing = 22;
    for (let i = -h; i < w + h; i += spacing) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
    }
  }},

  // 11 — Terminal Lines
  { label: "Terminal Lines", render: (ctx, w, h) => {
    ctx.font = "10px 'Space Mono', monospace";
    ctx.textBaseline = "top";
    const lines = [
      "$ curl -s /api/sync", "{ synced: 12 }", "$ node index.js",
      "listening on :3000", "POST /api/chat 200", "GET /api/triage 200",
      "$ npm run build", "compiled successfully", "$ redis-cli ping",
      "PONG", "$ git push origin", "-> main", "$ echo $STATUS", "OK",
    ];
    const lineH = 14;
    const rows = Math.floor(h / lineH);
    for (let r = 0; r < rows; r++) {
      const line = lines[r % lines.length];
      const alpha = 0.08 + hash(r, 77) * 0.07;
      const indent = hash(r, 44) > 0.7 ? 20 : 0;
      ctx.fillStyle = `rgba(${R},${G},${B2},${alpha})`;
      ctx.fillText(line, 8 + indent + hash(r, 22) * 40, r * lineH + 2);
    }
  }},

  // 12 — Hex Grid
  { label: "Hex Grid", render: (ctx, w, h, t) => {
    const size = 18;
    const rowH = size * Math.sqrt(3);
    for (let row = 0; row * rowH < h + size; row++) {
      const offset = (row % 2) * size * 0.75;
      for (let col = 0; col * size * 1.5 < w + size; col++) {
        const cx = col * size * 1.5 + offset;
        const cy = row * rowH;
        const pulse = Math.sin(cx * 0.02 + cy * 0.02 + t * 0.2) * 0.03;
        ctx.fillStyle = `rgba(${R},${G},${B2},${0.1 + pulse})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${R},${G},${B2},0.05)`;
        ctx.lineWidth = 0.5;
        if (col > 0) {
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - size * 1.5, cy); ctx.stroke();
        }
      }
    }
  }},

  // 13 — Gradient Bars
  { label: "Gradient Bars", render: (ctx, w, h, t) => {
    const barH = 3;
    const spacing = 10;
    for (let y = 0; y < h; y += spacing) {
      const shift = Math.sin(y * 0.03 + t * 0.2) * 0.3;
      const startX = w * (0.05 + shift);
      const endX = w * (0.6 + hash(y, 0) * 0.35 + shift);
      const grad = ctx.createLinearGradient(startX, 0, endX, 0);
      grad.addColorStop(0, `rgba(${R},${G},${B2},0)`);
      grad.addColorStop(0.3, `rgba(${R},${G},${B2},0.12)`);
      grad.addColorStop(0.7, `rgba(${R},${G},${B2},0.12)`);
      grad.addColorStop(1, `rgba(${R},${G},${B2},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, w, barH);
    }
  }},

  // 14 — Particle Field
  { label: "Particle Field", render: (ctx, w, h, t) => {
    ctx.font = "10px 'Space Mono', monospace";
    ctx.textBaseline = "top";
    const chars = ["0", "1", "{", "}", "(", ")", ";", ".", ":", "/", "*"];
    const n = 200;
    for (let i = 0; i < n; i++) {
      const x = hash(i, 0) * w;
      const y = (hash(i, 1) * h + t * (5 + hash(i, 2) * 10)) % h;
      const ch = chars[Math.floor(hash(i, 3) * chars.length)];
      const alpha = 0.07 + hash(i, 4) * 0.1;
      ctx.fillStyle = `rgba(${R},${G},${B2},${alpha})`;
      ctx.fillText(ch, x, y);
    }
  }},

  // 15 — Wave Lines
  { label: "Wave Lines", render: (ctx, w, h, t) => {
    ctx.lineWidth = 1;
    const spacing = 12;
    for (let y = spacing; y < h; y += spacing) {
      const freq = 0.008 + hash(y, 0) * 0.006;
      const amp = 3 + hash(y, 1) * 5;
      const speed = 0.2 + hash(y, 2) * 0.3;
      const alpha = 0.08 + Math.sin(y * 0.04 + t * 0.1) * 0.03;
      ctx.strokeStyle = `rgba(${R},${G},${B2},${Math.max(0.02, alpha)})`;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const dy = Math.sin(x * freq + t * speed) * amp;
        if (x === 0) ctx.moveTo(x, y + dy);
        else ctx.lineTo(x, y + dy);
      }
      ctx.stroke();
    }
  }},
];

// ── Background Canvas (fills parent) ──
function BgCanvas({ bg }: { bg: BgOption }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = parentRef.current;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) return;

    const rect = parent.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx.scale(dpr, dpr);

    let frame = 0;
    let rafId: number;

    function render() {
      frame++;
      ctx.clearRect(0, 0, cw, ch);
      bg.render(ctx, cw, ch, frame * 0.02);
      rafId = requestAnimationFrame(render);
    }

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [bg]);

  return (
    <div ref={parentRef} className="absolute inset-0">
      <canvas ref={ref} className="block" />
    </div>
  );
}

// ── Fake homepage mockup ──
function HomepageMock({ bg, number }: { bg: BgOption; number: number }) {
  return (
    <div className="relative rounded-lg border border-gray-800 overflow-hidden bg-[hsl(0,0%,4%)]" style={{ height: 340 }}>
      {/* Background layer */}
      <BgCanvas bg={bg} />

      {/* Fake UI content */}
      <div className="relative z-10 h-full flex flex-col">
        {/* Header bar */}
        <div className="flex items-center h-8 border-b border-gray-800/60 px-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-[#c0392b]/40" />
            <span className="text-[9px] text-gray-500 font-mono">Redmaester</span>
          </div>
          <div className="ml-auto flex gap-2">
            <div className="w-8 h-3 rounded bg-gray-800/40" />
            <div className="w-8 h-3 rounded bg-gray-800/40" />
            <div className="w-4 h-4 rounded-full bg-gray-800/40" />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 p-3 gap-3">
          {/* Left content area */}
          <div className="flex-1 min-w-0">
            {/* Filter bar */}
            <div className="flex gap-2 mb-3">
              <div className="h-5 w-28 rounded bg-gray-800/30 border border-gray-700/20" />
              <div className="h-5 w-14 rounded bg-gray-800/20" />
              <div className="h-5 w-14 rounded bg-gray-800/20" />
            </div>
            {/* Table rows */}
            <div className="space-y-1.5">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="flex items-center gap-2 h-5 px-2 rounded bg-gray-800/15">
                  <div className="w-3 h-3 rounded border border-gray-700/20" />
                  <div className="h-2 rounded bg-gray-600/15" style={{ width: `${40 + hash(i, 0) * 50}%` }} />
                  <div className="ml-auto h-2 w-10 rounded bg-gray-700/10" />
                </div>
              ))}
            </div>
          </div>

          {/* Right terminal panel */}
          <div className="w-[140px] shrink-0">
            <div className="rounded border border-gray-800/40 bg-black/20 h-full flex flex-col">
              <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-800/30">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500/40" />
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/40" />
                <div className="w-1.5 h-1.5 rounded-full bg-green-500/40" />
              </div>
              <div className="flex-1 p-2 space-y-1">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-1.5 rounded bg-gray-600/15" style={{ width: `${30 + hash(i, 5) * 60}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Label overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
        <span className="text-[11px] text-gray-400 font-mono">#{number} {bg.label}</span>
      </div>
    </div>
  );
}

// ── Page ──
export default function BackgroundsDemo() {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono&display=swap" rel="stylesheet" />
      <div className="min-h-screen bg-[hsl(0,0%,4%)] text-gray-300 font-mono">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <h1 className="text-2xl text-[#c0392b] mb-1">Homepage Backgrounds</h1>
          <p className="text-sm text-gray-500 mb-8">15 options shown on a homepage mockup. Click to enlarge.</p>

          {/* Full-size preview */}
          {selected !== null && (
            <div className="mb-10 cursor-pointer" onClick={() => setSelected(null)}>
              <div className="relative rounded-lg border border-[#c0392b]/40 overflow-hidden bg-[hsl(0,0%,4%)]" style={{ height: 600 }}>
                <BgCanvas bg={backgrounds[selected]} key={`full-${selected}`} />
                <div className="relative z-10 h-full flex flex-col">
                  <div className="flex items-center h-12 border-b border-gray-800/60 px-5 shrink-0">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded bg-[#c0392b]/40" />
                      <span className="text-sm text-gray-400 font-mono">Redmaester</span>
                    </div>
                    <div className="ml-auto flex gap-3 items-center">
                      <div className="h-4 w-12 rounded bg-gray-800/30" />
                      <div className="h-4 w-12 rounded bg-gray-800/30" />
                      <div className="w-7 h-7 rounded-full bg-gray-800/30" />
                    </div>
                  </div>
                  <div className="flex flex-1 min-h-0 p-5 gap-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex gap-3 mb-4">
                        <div className="h-8 w-48 rounded bg-gray-800/25 border border-gray-700/20" />
                        <div className="h-8 w-20 rounded bg-gray-800/15" />
                        <div className="h-8 w-20 rounded bg-gray-800/15" />
                      </div>
                      <div className="space-y-2">
                        {[...Array(14)].map((_, i) => (
                          <div key={i} className="flex items-center gap-3 h-8 px-3 rounded bg-gray-800/12">
                            <div className="w-4 h-4 rounded border border-gray-700/20" />
                            <div className="h-3 rounded bg-gray-600/12" style={{ width: `${35 + hash(i, 0) * 45}%` }} />
                            <div className="ml-auto h-3 w-16 rounded bg-gray-700/10" />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="w-[280px] shrink-0">
                      <div className="rounded-lg border border-gray-800/40 bg-black/20 h-full flex flex-col">
                        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-800/30">
                          <div className="w-2 h-2 rounded-full bg-red-500/40" />
                          <div className="w-2 h-2 rounded-full bg-yellow-500/40" />
                          <div className="w-2 h-2 rounded-full bg-green-500/40" />
                        </div>
                        <div className="flex-1 p-3 space-y-1.5">
                          {[...Array(12)].map((_, i) => (
                            <div key={i} className="h-2.5 rounded bg-gray-600/12" style={{ width: `${25 + hash(i, 5) * 65}%` }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2 text-center">#{selected + 1} — {backgrounds[selected].label} (click to close)</p>
            </div>
          )}

          {/* Grid of 15 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {backgrounds.map((bg, i) => (
              <div key={i} onClick={() => setSelected(i)} className="cursor-pointer">
                <HomepageMock bg={bg} number={i + 1} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
