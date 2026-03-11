"use client";

import { useEffect, useRef, useState } from "react";

// ── Grid ──
const CW = 8, CH = 12, FONT = 10, COLS = 32, ROWS = 26;
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
function B(px: number, py: number, cx: number, cy: number, hw: number, hh: number) {
  const dx = Math.abs(px - cx) - hw, dy = Math.abs(py - cy) - hh;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
function RB(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number) {
  const dx = Math.abs(px - cx) - hw + r, dy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
function S(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const dot = bax * bax + bay * bay;
  const h = dot > 0 ? cl((pax * bax + pay * bay) / dot, 0, 1) : 0;
  return Math.hypot(pax - bax * h, pay - bay * h);
}
function U(...a: number[]) { return Math.min(...a); }
function bri(d: number) { return ss(3, -3, d); }

// ── Side-profile armchair (facing right) ──
// The chair is drawn at fixed position so it's consistent across all shapes
function chair(px: number, py: number) {
  // Back (tall piece on the left)
  let d = RB(px, py, 52, 106, 16, 68, 10);
  // Seat cushion (wide horizontal)
  d = U(d, RB(px, py, 110, 176, 64, 10, 5));
  // Armrest (right side, above seat level)
  d = U(d, RB(px, py, 168, 140, 10, 30, 5));
  // Back leg
  d = U(d, S(px, py, 44, 186, 40, 280) - 5);
  // Front leg
  d = U(d, S(px, py, 168, 186, 172, 280) - 5);
  // Floor
  d = U(d, B(px, py, 128, 290, 110, 2));
  return d;
}

// ── Book pile helper ──
function bookPile(px: number, py: number, cx: number, baseY: number, count: number) {
  let d = Infinity;
  for (let i = 0; i < count; i++) {
    const w = 10 + ((i * 7 + 3) & 7);
    const off = ((i & 1) ? 2 : -1);
    d = U(d, RB(px, py, cx + off, baseY - i * 7, w, 2.5, 1));
  }
  return d;
}

// ── Mirror helper: flip any shape to face the other direction ──
function mirror(fn: (px: number, py: number) => number): (px: number, py: number) => number {
  return (px, py) => fn(W - px, py);
}

// Left-facing armchair (mirrored)
function chairLeft(px: number, py: number) {
  return chair(W - px, py);
}

// ── Shape type ──
type Shape = { label: string; fn: (px: number, py: number) => number };

// ── 10 side-profile reading poses (facing right) ──
const shapesRight: Shape[] = [

  // 1 — Classic: upright, book held in front at reading distance
  { label: "Classic Reader", fn: (px, py) => {
    let d = chair(px, py);
    // Head (with nose bump facing right)
    d = U(d, C(px, py, 108, 48, 20));
    d = U(d, C(px, py, 128, 50, 6)); // nose
    // Neck
    d = U(d, S(px, py, 106, 68, 96, 82) - 7);
    // Torso (side view, against chair back)
    d = U(d, RB(px, py, 90, 130, 20, 44, 6));
    // Upper arm (from shoulder, going down)
    d = U(d, S(px, py, 108, 92, 118, 130) - 7);
    // Forearm (bent forward, holding book)
    d = U(d, S(px, py, 118, 130, 156, 102) - 6.5);
    // Book (rectangle held in front of face)
    d = U(d, RB(px, py, 162, 86, 10, 22, 2));
    // Thigh (roughly horizontal on seat)
    d = U(d, S(px, py, 96, 168, 152, 172) - 12);
    // Calf (going down from knee)
    d = U(d, S(px, py, 152, 172, 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 2 — Absorbed: leaned forward, book close, elbows near knees
  { label: "Absorbed", fn: (px, py) => {
    let d = chair(px, py);
    // Head (lower, leaned forward)
    d = U(d, C(px, py, 126, 52, 20));
    d = U(d, C(px, py, 146, 54, 6));
    // Neck (leaned forward)
    d = U(d, S(px, py, 122, 72, 108, 86) - 7);
    // Torso (leaned forward from chair back)
    d = U(d, RB(px, py, 100, 130, 20, 42, 6));
    // Both arms forward and down, elbows near knees
    d = U(d, S(px, py, 116, 96, 136, 132) - 7);
    d = U(d, S(px, py, 136, 132, 156, 104) - 6.5);
    // Book (close to face, angled)
    d = U(d, RB(px, py, 160, 86, 8, 22, 2));
    // Thigh
    d = U(d, S(px, py, 100, 168, 154, 170) - 12);
    // Calf
    d = U(d, S(px, py, 154, 170, 148, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, 158, 272, 18, 7, 3));
    return bri(d);
  }},

  // 3 — Reclined: tilted back against chair, book resting on chest
  { label: "Reclined", fn: (px, py) => {
    let d = chair(px, py);
    // Head (further back and higher, resting on chair back)
    d = U(d, C(px, py, 90, 42, 20));
    d = U(d, C(px, py, 110, 44, 6));
    // Neck
    d = U(d, S(px, py, 88, 62, 82, 76) - 7);
    // Torso (reclined, more against chair back)
    d = U(d, RB(px, py, 82, 126, 20, 46, 6));
    // Arms: book resting on upper chest, arms relaxed
    d = U(d, S(px, py, 100, 88, 106, 120) - 7);
    d = U(d, S(px, py, 106, 120, 118, 106) - 6.5);
    // Book flat on chest
    d = U(d, RB(px, py, 110, 100, 18, 10, 2));
    // Thigh
    d = U(d, S(px, py, 94, 168, 152, 174) - 12);
    // Calf
    d = U(d, S(px, py, 152, 174, 146, 264) - 8.5);
    // Foot
    d = U(d, RB(px, py, 156, 274, 18, 7, 3));
    return bri(d);
  }},

  // 4 — Crossed legs: ankle on knee, book held up in one hand
  { label: "Legs Crossed", fn: (px, py) => {
    let d = chair(px, py);
    // Head
    d = U(d, C(px, py, 108, 48, 20));
    d = U(d, C(px, py, 128, 50, 6));
    // Neck
    d = U(d, S(px, py, 106, 68, 96, 82) - 7);
    // Torso
    d = U(d, RB(px, py, 90, 130, 20, 44, 6));
    // Right arm holding book up
    d = U(d, S(px, py, 108, 92, 118, 120) - 7);
    d = U(d, S(px, py, 118, 120, 150, 90) - 6.5);
    // Book held up
    d = U(d, RB(px, py, 156, 74, 10, 22, 2));
    // Left leg (straight, on seat then down)
    d = U(d, S(px, py, 96, 168, 140, 172) - 12);
    d = U(d, S(px, py, 140, 172, 136, 264) - 8.5);
    d = U(d, RB(px, py, 144, 274, 18, 7, 3));
    // Right leg crossed: ankle resting on left knee
    d = U(d, S(px, py, 104, 168, 148, 156) - 10);
    d = U(d, S(px, py, 148, 156, 126, 170) - 8);
    return bri(d);
  }},

  // 5 — One-handed: left arm on armrest, right holds book
  { label: "One-Handed", fn: (px, py) => {
    let d = chair(px, py);
    // Head (looking right toward book)
    d = U(d, C(px, py, 112, 48, 20));
    d = U(d, C(px, py, 132, 50, 6));
    // Neck
    d = U(d, S(px, py, 108, 68, 98, 82) - 7);
    // Torso
    d = U(d, RB(px, py, 92, 130, 20, 44, 6));
    // Left arm resting on armrest (back arm, barely visible in profile)
    d = U(d, S(px, py, 104, 92, 112, 140) - 6);
    // Right arm holding book out to the right
    d = U(d, S(px, py, 110, 94, 130, 126) - 7);
    d = U(d, S(px, py, 130, 126, 170, 100) - 6.5);
    // Book in right hand
    d = U(d, RB(px, py, 176, 84, 10, 22, 2));
    // Thigh
    d = U(d, S(px, py, 98, 168, 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, 152, 172, 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 6 — Feet up: legs on ottoman, book on chest
  { label: "Feet Up", fn: (px, py) => {
    let d = chair(px, py);
    // Head
    d = U(d, C(px, py, 96, 44, 20));
    d = U(d, C(px, py, 116, 46, 6));
    // Neck
    d = U(d, S(px, py, 94, 64, 86, 78) - 7);
    // Torso (slightly reclined)
    d = U(d, RB(px, py, 84, 128, 20, 46, 6));
    // Arms: holding book on upper chest
    d = U(d, S(px, py, 102, 88, 108, 118) - 7);
    d = U(d, S(px, py, 108, 118, 122, 102) - 6.5);
    // Book on chest
    d = U(d, RB(px, py, 116, 96, 16, 12, 2));
    // Legs stretched forward onto ottoman (nearly horizontal)
    d = U(d, S(px, py, 94, 168, 196, 186) - 11);
    // Lower leg resting on ottoman
    d = U(d, S(px, py, 196, 186, 218, 196) - 8);
    // Ottoman / footrest
    d = U(d, RB(px, py, 210, 212, 28, 12, 5));
    d = U(d, RB(px, py, 190, 234, 5, 16, 2), RB(px, py, 230, 234, 5, 16, 2));
    // Floor
    d = U(d, B(px, py, 180, 290, 70, 2));
    return bri(d);
  }},

  // 7 — Deep slouch: slid down, legs way out
  { label: "Slouched", fn: (px, py) => {
    let d = chair(px, py);
    // Head (low, sunk into chair)
    d = U(d, C(px, py, 96, 68, 20));
    d = U(d, C(px, py, 116, 70, 6));
    // Neck (short, slouched)
    d = U(d, S(px, py, 94, 88, 88, 98) - 7);
    // Torso (lower in chair, slouched)
    d = U(d, RB(px, py, 86, 140, 20, 40, 6));
    // Arms: book held loosely on belly
    d = U(d, S(px, py, 104, 106, 110, 136) - 7);
    d = U(d, S(px, py, 110, 136, 128, 120) - 6.5);
    // Book on belly
    d = U(d, RB(px, py, 120, 130, 16, 12, 2));
    // Legs stretched far out
    d = U(d, S(px, py, 96, 174, 168, 192) - 12);
    // Long calves going way out
    d = U(d, S(px, py, 168, 192, 200, 264) - 8.5);
    // Foot
    d = U(d, RB(px, py, 210, 274, 18, 7, 3));
    return bri(d);
  }},

  // 8 — Page turner: one hand high turning page, other holding book
  { label: "Page Turner", fn: (px, py) => {
    let d = chair(px, py);
    // Head
    d = U(d, C(px, py, 108, 48, 20));
    d = U(d, C(px, py, 128, 50, 6));
    // Neck
    d = U(d, S(px, py, 106, 68, 96, 82) - 7);
    // Torso
    d = U(d, RB(px, py, 90, 130, 20, 44, 6));
    // Left arm holding book steady
    d = U(d, S(px, py, 108, 92, 118, 126) - 7);
    d = U(d, S(px, py, 118, 126, 150, 108) - 6.5);
    // Right arm reaching up to turn page
    d = U(d, S(px, py, 112, 96, 142, 74) - 6.5);
    d = U(d, S(px, py, 142, 74, 164, 68) - 5); // hand near top of book
    // Book (open, taller to show pages)
    d = U(d, RB(px, py, 158, 88, 12, 26, 2));
    // Small flap (turning page)
    d = U(d, S(px, py, 162, 64, 170, 56) - 4);
    // Thigh
    d = U(d, S(px, py, 96, 168, 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, 152, 172, 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 9 — Contemplative: looking up, book lowered in lap, thinking
  { label: "Contemplative", fn: (px, py) => {
    let d = chair(px, py);
    // Head (tilted back and up — looking at ceiling)
    d = U(d, C(px, py, 100, 42, 20));
    d = U(d, C(px, py, 118, 36, 6)); // nose pointing up-right
    // Neck (exposed, head tilted back)
    d = U(d, S(px, py, 98, 62, 90, 78) - 7);
    // Torso
    d = U(d, RB(px, py, 88, 128, 20, 46, 6));
    // Arms relaxed, book in lap
    d = U(d, S(px, py, 106, 90, 112, 130) - 7);
    d = U(d, S(px, py, 112, 130, 126, 158) - 6.5);
    // Book flat in lap
    d = U(d, RB(px, py, 124, 164, 18, 8, 2));
    // Thigh
    d = U(d, S(px, py, 96, 168, 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, 152, 172, 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 10 — Nodding off: head drooping, book sliding
  { label: "Nodding Off", fn: (px, py) => {
    let d = chair(px, py);
    // Head (drooped forward and down — falling asleep)
    d = U(d, C(px, py, 116, 66, 20));
    d = U(d, C(px, py, 134, 72, 6)); // nose pointing down-right
    // Neck (bent forward)
    d = U(d, S(px, py, 110, 86, 96, 94) - 7);
    // Torso
    d = U(d, RB(px, py, 88, 136, 20, 42, 6));
    // Left arm limp on armrest
    d = U(d, S(px, py, 106, 100, 112, 140) - 6);
    d = U(d, S(px, py, 112, 140, 118, 156) - 5);
    // Right arm: book sliding off, hand going limp
    d = U(d, S(px, py, 108, 104, 124, 140) - 7);
    d = U(d, S(px, py, 124, 140, 146, 164) - 6);
    // Book sliding/tilted at an angle
    d = U(d, S(px, py, 148, 156, 162, 188) - 6);
    d = U(d, S(px, py, 154, 154, 168, 186) - 6);
    // Thigh
    d = U(d, S(px, py, 96, 172, 152, 176) - 12);
    // Calf
    d = U(d, S(px, py, 152, 176, 146, 264) - 8.5);
    // Foot
    d = U(d, RB(px, py, 156, 274, 18, 7, 3));
    // Book pile on floor (books he already finished)
    d = U(d, bookPile(px, py, 200, 286, 3));
    return bri(d);
  }},
];

// ── 10 side-profile reading poses (facing left) ──
const shapesLeft: Shape[] = [

  // 11 — Engrossed: deep in a thick book, held with both hands
  { label: "Engrossed", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W; // mirror constant
    // Head
    d = U(d, C(px, py, mx - 108, 48, 20));
    d = U(d, C(px, py, mx - 128, 50, 6)); // nose facing left
    // Neck
    d = U(d, S(px, py, mx - 106, 68, mx - 96, 82) - 7);
    // Torso
    d = U(d, RB(px, py, mx - 90, 130, 20, 44, 6));
    // Both arms forward, gripping book firmly
    d = U(d, S(px, py, mx - 108, 92, mx - 120, 124) - 7);
    d = U(d, S(px, py, mx - 120, 124, mx - 148, 96) - 6.5);
    // Thick book held in front
    d = U(d, RB(px, py, mx - 154, 80, 12, 24, 2));
    // Thigh
    d = U(d, S(px, py, mx - 96, 168, mx - 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, mx - 152, 172, mx - 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 12 — Stretching: one arm up stretching, book in lap
  { label: "Stretching", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head (tilted back)
    d = U(d, C(px, py, mx - 100, 44, 20));
    d = U(d, C(px, py, mx - 118, 38, 6));
    // Neck
    d = U(d, S(px, py, mx - 98, 64, mx - 90, 78) - 7);
    // Torso
    d = U(d, RB(px, py, mx - 88, 128, 20, 46, 6));
    // Left arm stretching up high
    d = U(d, S(px, py, mx - 100, 88, mx - 96, 52) - 7);
    d = U(d, S(px, py, mx - 96, 52, mx - 82, 32) - 5.5);
    // Right arm resting on book in lap
    d = U(d, S(px, py, mx - 106, 92, mx - 114, 130) - 7);
    d = U(d, S(px, py, mx - 114, 130, mx - 124, 158) - 6);
    // Book flat in lap
    d = U(d, RB(px, py, mx - 122, 164, 18, 8, 2));
    // Thigh
    d = U(d, S(px, py, mx - 96, 168, mx - 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, mx - 152, 172, mx - 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 13 — Hunched: elbows on knees, book between hands
  { label: "Hunched", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head (low, far forward)
    d = U(d, C(px, py, mx - 138, 62, 20));
    d = U(d, C(px, py, mx - 158, 64, 6));
    // Neck (forward lean)
    d = U(d, S(px, py, mx - 132, 82, mx - 108, 96) - 7);
    // Torso (hunched forward off the chair back)
    d = U(d, RB(px, py, mx - 100, 134, 20, 38, 6));
    // Arms down, elbows near knees
    d = U(d, S(px, py, mx - 116, 102, mx - 134, 144) - 7);
    d = U(d, S(px, py, mx - 134, 144, mx - 156, 110) - 6.5);
    // Book held between knees level
    d = U(d, RB(px, py, mx - 162, 96, 10, 22, 2));
    // Thigh
    d = U(d, S(px, py, mx - 96, 168, mx - 150, 170) - 12);
    // Calf
    d = U(d, S(px, py, mx - 150, 170, mx - 144, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 154, 272, 18, 7, 3));
    return bri(d);
  }},

  // 14 — Arm dangling: one arm hangs over chair side, other holds book
  { label: "Arm Dangling", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head
    d = U(d, C(px, py, mx - 104, 48, 20));
    d = U(d, C(px, py, mx - 124, 50, 6));
    // Neck
    d = U(d, S(px, py, mx - 102, 68, mx - 94, 82) - 7);
    // Torso
    d = U(d, RB(px, py, mx - 88, 130, 20, 44, 6));
    // Left arm: dangling over chair back (behind, to the right in mirrored view)
    d = U(d, S(px, py, mx - 80, 92, mx - 60, 120) - 6.5);
    d = U(d, S(px, py, mx - 60, 120, mx - 54, 150) - 5.5);
    // Right arm holding book in front
    d = U(d, S(px, py, mx - 106, 94, mx - 120, 126) - 7);
    d = U(d, S(px, py, mx - 120, 126, mx - 152, 100) - 6.5);
    // Book
    d = U(d, RB(px, py, mx - 158, 84, 10, 22, 2));
    // Thigh
    d = U(d, S(px, py, mx - 96, 168, mx - 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, mx - 152, 172, mx - 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 15 — Head on hand: elbow on armrest, chin resting on hand
  { label: "Head on Hand", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head (slightly tilted, resting on hand)
    d = U(d, C(px, py, mx - 116, 48, 20));
    d = U(d, C(px, py, mx - 136, 52, 6));
    // Neck
    d = U(d, S(px, py, mx - 112, 68, mx - 98, 80) - 7);
    // Torso
    d = U(d, RB(px, py, mx - 90, 130, 20, 44, 6));
    // Left arm: elbow on armrest, hand under chin
    d = U(d, S(px, py, mx - 106, 92, mx - 130, 124) - 7);
    d = U(d, S(px, py, mx - 130, 124, mx - 128, 58) - 6);
    // Right arm: holding book in lap
    d = U(d, S(px, py, mx - 104, 94, mx - 112, 130) - 7);
    d = U(d, S(px, py, mx - 112, 130, mx - 130, 152) - 6);
    // Book in lap area
    d = U(d, RB(px, py, mx - 132, 156, 16, 12, 2));
    // Thigh
    d = U(d, S(px, py, mx - 96, 168, mx - 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, mx - 152, 172, mx - 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 156, 272, 18, 7, 3));
    return bri(d);
  }},

  // 16 — Edge sitter: perched on front of chair, book close
  { label: "Edge Sitter", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head (forward, alert posture)
    d = U(d, C(px, py, mx - 130, 50, 20));
    d = U(d, C(px, py, mx - 150, 52, 6));
    // Neck
    d = U(d, S(px, py, mx - 126, 70, mx - 112, 84) - 7);
    // Torso (shifted forward off the chair back)
    d = U(d, RB(px, py, mx - 106, 128, 20, 42, 6));
    // Both arms holding book in front
    d = U(d, S(px, py, mx - 122, 92, mx - 138, 122) - 7);
    d = U(d, S(px, py, mx - 138, 122, mx - 162, 94) - 6.5);
    // Book
    d = U(d, RB(px, py, mx - 168, 78, 10, 22, 2));
    // Thigh (steeper angle — perched forward)
    d = U(d, S(px, py, mx - 112, 166, mx - 152, 178) - 12);
    // Calf
    d = U(d, S(px, py, mx - 152, 178, mx - 144, 264) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 154, 274, 18, 7, 3));
    return bri(d);
  }},

  // 17 — Book overhead: lying back, holding book above face
  { label: "Book Overhead", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head (reclined deep)
    d = U(d, C(px, py, mx - 86, 56, 20));
    d = U(d, C(px, py, mx - 104, 50, 6));
    // Neck
    d = U(d, S(px, py, mx - 84, 76, mx - 80, 88) - 7);
    // Torso (reclined)
    d = U(d, RB(px, py, mx - 82, 132, 20, 42, 6));
    // Both arms up, holding book overhead
    d = U(d, S(px, py, mx - 96, 96, mx - 108, 68) - 7);
    d = U(d, S(px, py, mx - 108, 68, mx - 124, 44) - 6.5);
    // Book held above face
    d = U(d, RB(px, py, mx - 128, 32, 14, 16, 2));
    // Thigh
    d = U(d, S(px, py, mx - 92, 168, mx - 148, 174) - 12);
    // Calf
    d = U(d, S(px, py, mx - 148, 174, mx - 142, 264) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 152, 274, 18, 7, 3));
    return bri(d);
  }},

  // 18 — Knees up: feet on seat, knees bent up, book resting on knees
  { label: "Knees Up", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head
    d = U(d, C(px, py, mx - 104, 42, 20));
    d = U(d, C(px, py, mx - 124, 44, 6));
    // Neck
    d = U(d, S(px, py, mx - 102, 62, mx - 94, 76) - 7);
    // Torso (slightly reclined)
    d = U(d, RB(px, py, mx - 88, 120, 20, 42, 6));
    // Arms forward, resting book on knees
    d = U(d, S(px, py, mx - 104, 84, mx - 118, 114) - 7);
    d = U(d, S(px, py, mx - 118, 114, mx - 138, 102) - 6.5);
    // Book propped on knees
    d = U(d, RB(px, py, mx - 142, 86, 10, 20, 2));
    // Upper legs going UP (knees raised)
    d = U(d, S(px, py, mx - 96, 158, mx - 128, 108) - 11);
    // Lower legs tucked back down to seat
    d = U(d, S(px, py, mx - 128, 108, mx - 140, 168) - 8.5);
    // Feet on seat
    d = U(d, RB(px, py, mx - 144, 174, 12, 6, 3));
    return bri(d);
  }},

  // 19 — Side lean: leaning on one armrest, book in other hand
  { label: "Side Lean", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head (tilted toward armrest)
    d = U(d, C(px, py, mx - 96, 46, 20));
    d = U(d, C(px, py, mx - 114, 42, 6));
    // Neck
    d = U(d, S(px, py, mx - 94, 66, mx - 86, 80) - 7);
    // Torso (leaning toward chair back / left armrest area)
    d = U(d, RB(px, py, mx - 84, 126, 20, 44, 6));
    // Left arm (closer to viewer): resting against chair back
    d = U(d, S(px, py, mx - 76, 90, mx - 66, 124) - 6.5);
    // Right arm: extended holding book out
    d = U(d, S(px, py, mx - 102, 92, mx - 118, 126) - 7);
    d = U(d, S(px, py, mx - 118, 126, mx - 150, 100) - 6.5);
    // Book held out
    d = U(d, RB(px, py, mx - 156, 84, 10, 22, 2));
    // Thigh
    d = U(d, S(px, py, mx - 94, 168, mx - 150, 174) - 12);
    // Calf
    d = U(d, S(px, py, mx - 150, 174, mx - 144, 264) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 154, 274, 18, 7, 3));
    return bri(d);
  }},

  // 20 — Tea break: book in lap, other hand holding cup
  { label: "Tea Break", fn: (px, py) => {
    let d = chairLeft(px, py);
    const mx = W;
    // Head
    d = U(d, C(px, py, mx - 106, 48, 20));
    d = U(d, C(px, py, mx - 126, 50, 6));
    // Neck
    d = U(d, S(px, py, mx - 104, 68, mx - 96, 82) - 7);
    // Torso
    d = U(d, RB(px, py, mx - 90, 130, 20, 44, 6));
    // Left arm: holding teacup out to the side
    d = U(d, S(px, py, mx - 104, 92, mx - 126, 106) - 7);
    d = U(d, S(px, py, mx - 126, 106, mx - 140, 96) - 6);
    // Teacup
    d = U(d, RB(px, py, mx - 146, 90, 8, 10, 3));
    d = U(d, S(px, py, mx - 154, 84, mx - 158, 96) - 2.5); // handle
    // Right arm: resting on book in lap
    d = U(d, S(px, py, mx - 100, 96, mx - 108, 130) - 7);
    d = U(d, S(px, py, mx - 108, 130, mx - 120, 156) - 6);
    // Book in lap
    d = U(d, RB(px, py, mx - 118, 162, 18, 8, 2));
    // Thigh
    d = U(d, S(px, py, mx - 96, 168, mx - 152, 172) - 12);
    // Calf
    d = U(d, S(px, py, mx - 152, 172, mx - 146, 262) - 8.5);
    // Foot
    d = U(d, RB(px, py, mx - 156, 272, 18, 7, 3));
    // Small side table with book pile
    d = U(d, B(px, py, mx - 200, 250, 24, 4));
    d = U(d, S(px, py, mx - 200, 254, mx - 200, 288) - 4);
    d = U(d, bookPile(px, py, mx - 200, 244, 3));
    return bri(d);
  }},
];

// ── All shapes combined ──
const shapes: Shape[] = [...shapesRight, ...shapesLeft];

// ── Dissolve Canvas (no scanlines) ──

function DissolveCanvas({ shape }: { shape: Shape }) {
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
        shapeB[i] = shape.fn(c * CW + CW / 2, r * CH + CH / 2);
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
  }, [shape]);

  return <canvas ref={ref} className="block" />;
}

// ── Page ──

export default function DemoPage() {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Space+Mono&display=swap" rel="stylesheet" />
      <div className="min-h-screen bg-[#080404] text-gray-300 font-mono">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <h1 className="text-2xl text-[#c0392b] mb-2">Seated Reader — Side Profile</h1>
          <p className="text-sm text-gray-500 mb-10">20 armchair reading poses. Click any to enlarge.</p>

          {/* Enlarged preview */}
          {selected !== null && (
            <div className="mb-12 flex flex-col items-center">
              <div
                className="border border-gray-800 rounded-lg p-8 bg-[#0a0a0a] cursor-pointer"
                onClick={() => setSelected(null)}
                style={{ transform: "scale(2)", transformOrigin: "top center", marginBottom: `${H * 2 + 40}px` }}
              >
                <DissolveCanvas shape={shapes[selected]} key={`big-${selected}`} />
              </div>
              <p className="text-xs text-gray-500">#{selected + 1} — {shapes[selected].label} (click to close)</p>
            </div>
          )}

          {/* Facing right */}
          <h2 className="text-lg text-gray-400 mb-4">Facing Right</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 mb-12">
            {shapesRight.map((s, i) => (
              <div
                key={i}
                onClick={() => setSelected(i)}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer transition-colors ${
                  selected === i
                    ? "border-[#c0392b] bg-[#c0392b10]"
                    : "border-gray-800 hover:border-gray-600 bg-[#0a0a0a]"
                }`}
              >
                <DissolveCanvas shape={s} key={`grid-${i}`} />
                <span className="text-xs text-gray-500">#{i + 1} {s.label}</span>
              </div>
            ))}
          </div>

          {/* Facing left */}
          <h2 className="text-lg text-gray-400 mb-4">Facing Left</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {shapesLeft.map((s, i) => {
              const idx = shapesRight.length + i;
              return (
                <div
                  key={idx}
                  onClick={() => setSelected(idx)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selected === idx
                      ? "border-[#c0392b] bg-[#c0392b10]"
                      : "border-gray-800 hover:border-gray-600 bg-[#0a0a0a]"
                  }`}
                >
                  <DissolveCanvas shape={s} key={`grid-${idx}`} />
                  <span className="text-xs text-gray-500">#{idx + 1} {s.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
