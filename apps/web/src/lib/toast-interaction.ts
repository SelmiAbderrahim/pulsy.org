/** The toast is portalled from the root React tree, even when its DOM is in a modal. */
export function isToastInteraction(event: Event): boolean {
  return event.target instanceof Element && Boolean(event.target.closest("[data-toast-host]"));
}
