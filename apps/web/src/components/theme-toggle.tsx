import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

const STORAGE_KEY = "pulsy-theme";

function getInitialTheme(): Theme {
	if (typeof window === "undefined") return "light";

	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (stored === "light" || stored === "dark") return stored;

	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(theme: Theme) {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
	const { t } = useTranslation("common");
	const [theme, setTheme] = useState<Theme>(getInitialTheme);

	useEffect(() => {
		applyTheme(theme);
		window.localStorage.setItem(STORAGE_KEY, theme);
	}, [theme]);

	const nextTheme: Theme = theme === "dark" ? "light" : "dark";

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			className="h-[44px] w-[44px]"
			aria-label={
				theme === "dark"
					? t("theme.switchToLight", "Switch to light mode")
					: t("theme.switchToDark", "Switch to dark mode")
			}
			onClick={() => setTheme(nextTheme)}
		>
			<Sun className="h-4 w-4 dark:hidden" />
			<Moon className="hidden h-4 w-4 dark:block" />
		</Button>
	);
}
