import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { chooseTheme, getTheme, subscribeTheme } from "@/lib/theme";
export { initializeTheme } from "@/lib/theme";

export function ThemeToggle() {
	const { t } = useTranslation("common");
	const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "light");

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
			onClick={() => chooseTheme(getTheme() === "dark" ? "light" : "dark")}
		>
			{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
		</Button>
	);
}
