"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function BrandLink() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <Link href="/" className="inline-flex items-center gap-2.5">
      <svg width="24" height="22" viewBox="0 0 20 18" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
        <rect x="0" y="0" width="2" height="14" fill="#c0392b" />
        <rect x="2" y="2" width="2" height="14" fill="#e74c3c" />
        <rect x="4" y="4" width="2" height="14" fill="#e74c3c" />
        <rect x="6" y="6" width="2" height="12" fill="#e74c3c" />
        <rect x="8" y="8" width="2" height="10" fill="#922b21" />
        <rect x="10" y="8" width="2" height="10" fill="#922b21" />
        <rect x="12" y="6" width="2" height="12" fill="#e74c3c" />
        <rect x="14" y="4" width="2" height="14" fill="#e74c3c" />
        <rect x="16" y="2" width="2" height="14" fill="#e74c3c" />
        <rect x="18" y="0" width="2" height="14" fill="#c0392b" />
      </svg>
      <span
        className={`overflow-hidden transition-all duration-200 ${
          scrolled ? "w-0 opacity-0" : "w-auto opacity-100"
        }`}
        style={{ fontFamily: "'Pixelify Sans', sans-serif", fontWeight: 700, fontSize: "18px", letterSpacing: "1px", whiteSpace: "nowrap" }}
      >
        <span className="text-black">Red</span>
        <span className="text-[#c0392b]">maester</span>
      </span>
    </Link>
  );
}
