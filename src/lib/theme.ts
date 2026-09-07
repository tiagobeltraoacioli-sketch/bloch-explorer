// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Theme state: one attribute on <html>, one key in localStorage.
//
// `index.html` stamps the resolved theme before the first paint (see the
// inline script there); this module is the runtime half — the toggle, the
// persisted choice, and a hook so any component can re-render on change. The
// attribute is the single source of truth: nothing in CSS asks the OS.

import { useEffect, useState } from "react";

export type ThemeChoice = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_KEY = "bloch.explorer.theme";

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

/** The stored choice. Defaults to dark — the same default the wallet ships. */
export function themeChoice(): ThemeChoice {
  try {
    const s = localStorage.getItem(THEME_KEY);
    if (s === "light" || s === "dark" || s === "system") return s;
  } catch {
    /* storage unavailable */
  }
  return "dark";
}

export function resolveTheme(choice: ThemeChoice = themeChoice()): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

const listeners = new Set<(t: ResolvedTheme) => void>();

function paint(resolved: ResolvedTheme) {
  document.documentElement.setAttribute("data-theme", resolved);
  const meta = document.getElementById("themeColor");
  if (meta) meta.setAttribute("content", resolved === "light" ? "#f4f7f6" : "#070d0b");
  listeners.forEach((f) => f(resolved));
}

export function setTheme(choice: ThemeChoice): ResolvedTheme {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  const r = resolveTheme(choice);
  paint(r);
  return r;
}

/** Flip between the two explicit themes. */
export function toggleTheme(): ResolvedTheme {
  return setTheme(resolveTheme() === "dark" ? "light" : "dark");
}

/** The resolved theme, re-rendering on change. */
export function useTheme(): ResolvedTheme {
  const [t, setT] = useState<ResolvedTheme>(() =>
    typeof document === "undefined"
      ? "dark"
      : ((document.documentElement.getAttribute("data-theme") as ResolvedTheme) || resolveTheme()),
  );
  useEffect(() => {
    listeners.add(setT);
    // Follow the OS while the choice is "system".
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
    const onScheme = () => {
      if (themeChoice() === "system") paint(systemTheme());
    };
    mq?.addEventListener?.("change", onScheme);
    return () => {
      listeners.delete(setT);
      mq?.removeEventListener?.("change", onScheme);
    };
  }, []);
  return t;
}
