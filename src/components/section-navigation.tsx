"use client";
import { useEffect } from "react";
export function SectionNavigation() {
  useEffect(() => {
    function reveal() {
      const target = document.getElementById(window.location.hash.slice(1));
      if (!target) return;
      let node: HTMLElement | null = target;
      while (node) { if (node instanceof HTMLDetailsElement) node.open = true; node = node.parentElement; }
      const own = target.querySelector("details"); if (own) own.open = true;
      target.scrollIntoView({ block: "start" });
    }
    window.addEventListener("hashchange", reveal); reveal();
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  return null;
}
