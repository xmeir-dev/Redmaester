"use client";

import { useEffect, useRef } from "react";

const R = 192, G = 57, B = 43; // #c0392b

export function CodeRainBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) return;

    let cw = 0, ch = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      cw = window.innerWidth;
      ch = window.innerHeight;
      canvas!.width = Math.round(cw * dpr);
      canvas!.height = Math.round(ch * dpr);
      canvas!.style.width = `${cw}px`;
      canvas!.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    let rafId: number;

    function render() {
      frame++;
      const t = frame * 0.02;
      ctx.clearRect(0, 0, cw, ch);

      const spacing = 14;
      for (let y = spacing / 2; y < ch; y += spacing) {
        for (let x = spacing / 2; x < cw; x += spacing) {
          const pulse = Math.sin(x * 0.05 + y * 0.03 + t * 0.4) * 0.04;
          const alpha = 0.1 + pulse;
          ctx.fillStyle = `rgba(${R},${G},${B},${Math.max(0.02, alpha)})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      rafId = requestAnimationFrame(render);
    }

    rafId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
}
