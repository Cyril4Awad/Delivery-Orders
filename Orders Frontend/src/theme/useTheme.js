import { useCallback, useEffect, useRef, useState } from "react";
import "./themeTransition.css";

export const THEME_KEY = "vr-theme";
const FADE_MS = 450;

export function getStoredTheme() {
    try {
        return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch {
        return "light";
    }
}

export function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
}

/*
 * Switches the theme with one smooth cross-fade of the whole page. Browsers with the View
 * Transitions API snapshot the old and new page and blend them; others get a short colour
 * transition on every element instead of each component snapping on its own schedule.
 */
function switchTheme(commit) {
    if (document.startViewTransition) {
        document.startViewTransition(commit);
        return;
    }
    const root = document.documentElement;
    root.classList.add("theme-fading");
    commit();
    window.setTimeout(() => root.classList.remove("theme-fading"), FADE_MS);
}

// Light/dark theme persisted per browser; sets data-theme on <html>.
export function useTheme() {
    const [theme, setTheme] = useState(getStoredTheme);
    const themeRef = useRef(theme);
    themeRef.current = theme;

    useEffect(() => {
        applyTheme(theme);
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch {
            // storage unavailable - theme still applies for this session
        }
    }, [theme]);

    const toggleTheme = useCallback(() => {
        const next = themeRef.current === "dark" ? "light" : "dark";
        // Apply to the DOM synchronously so the transition captures the new theme.
        switchTheme(() => {
            applyTheme(next);
            setTheme(next);
        });
    }, []);

    return { theme, isDark: theme === "dark", setTheme, toggleTheme };
}
