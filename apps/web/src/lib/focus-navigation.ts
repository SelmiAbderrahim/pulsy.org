/**
 * Where keyboard focus starts when the mobile navigation drawer opens.
 *
 * Radix' automatic dialog focus deliberately skips links, so in a drawer made of links it
 * lands on the first *button* (here "Preferences", farther down the list) and a keyboard or
 * screen-reader user starts mid-menu. Start at the page the person is on instead, or at the
 * first destination. Returns whether something was focused.
 */
export function focusNavigationStart(drawer: HTMLElement | null): boolean {
	const target =
		drawer?.querySelector<HTMLElement>('nav a[aria-current="page"]') ??
		drawer?.querySelector<HTMLElement>("nav a[href]");
	if (!target) return false;
	target.focus();
	return true;
}
