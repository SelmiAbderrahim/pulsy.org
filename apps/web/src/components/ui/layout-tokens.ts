/** Shared overlay widths; use at call sites instead of ad hoc width overrides. */
export const layoutTokens = {
  listDrawer: "sm:max-w-[var(--management-drawer-width)]",
  complexDrawer: "sm:max-w-[var(--management-drawer-width)]",
  createDialog: "max-w-[var(--dialog-standard)]",
  /** WCAG 2.5.5 minimum pointer target (44 × 44 px) that flex rows cannot shrink. */
  touchTarget: "min-h-11 min-w-11 shrink-0",
} as const;
