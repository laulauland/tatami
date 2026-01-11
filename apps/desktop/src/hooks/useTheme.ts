import { useCallback, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "tatami-theme";
const DEFAULT_THEME: ThemeMode = "system";

function getStoredTheme(): ThemeMode {
	if (typeof window === "undefined") return DEFAULT_THEME;
	const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
	if (stored === "light" || stored === "dark" || stored === "system") return stored;
	return DEFAULT_THEME;
}

function resolveTheme(mode: ThemeMode): "light" | "dark" {
	if (mode === "light" || mode === "dark") return mode;
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
	if (typeof document === "undefined") return;
	const resolved = resolveTheme(mode);
	document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function initializeTheme(): ThemeMode {
	const mode = getStoredTheme();
	applyTheme(mode);
	return mode;
}

export function useTheme() {
	const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());

	useEffect(() => {
		applyTheme(theme);
		window.localStorage.setItem(THEME_STORAGE_KEY, theme);
	}, [theme]);

	useEffect(() => {
		if (theme !== "system") return;
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => applyTheme("system");
		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, [theme]);

	const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);

	const cycleTheme = useCallback(() => {
		setTheme((current) => {
			switch (current) {
				case "light":
					return "dark";
				case "dark":
					return "system";
				default:
					return "light";
			}
		});
	}, []);

	return { theme, resolvedTheme, setTheme, cycleTheme };
}
