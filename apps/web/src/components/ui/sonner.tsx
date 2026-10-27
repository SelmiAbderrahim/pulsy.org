import { useTranslation } from "react-i18next";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { mountToastPolicy, pauseToasts } from "@/lib/toast";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

/**
 * Toast container. Mount once near the app root. Theme follows the document
 * `.dark` class via CSS variables.
 */
function Toaster(props: ToasterProps) {
  const { t, i18n } = useTranslation("common");
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [modal, setModal] = useState(false);
  const [modalError, setModalError] = useState("");
  useEffect(mountToastPolicy, []);
  useEffect(() => {
    const root = document.createElement("div");
    root.dataset.toastHost = "";
    root.setAttribute("aria-live", "polite");
    let previousModal: HTMLElement | undefined;
    const showError = (event: Event) => setModalError((event as CustomEvent<string>).detail);
    document.addEventListener("pulsy:modal-error", showError, true);
    const relocate = () => {
      const openModal = [...document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]')].at(-1);
      if (previousModal !== openModal) { setModalError(""); previousModal = openModal; }
      const target = openModal ?? (window.innerWidth < 640 ? document.querySelector<HTMLElement>("#app-main") : null) ?? document.body;
      if (root.parentElement !== target) target.prepend(root);
      root.dataset.modal = String(Boolean(openModal));
      setModal(Boolean(openModal));
      for (const toast of root.querySelectorAll('[data-sonner-toast]')) {
        const error = toast.getAttribute("data-type") === "error";
        if (toast.getAttribute("role") !== (error ? "alert" : "status")) {
          toast.setAttribute("role", error ? "alert" : "status");
          toast.setAttribute("aria-live", error ? "assertive" : "polite");
        }
      }
    };
    relocate(); setHost(root);
    window.addEventListener("resize", relocate);
    const observer = new MutationObserver(relocate);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    const pause = () => pauseToasts(document.hidden || root.matches(":hover") || root.contains(document.activeElement));
    root.addEventListener("pointerenter", pause); root.addEventListener("pointerleave", pause);
    root.addEventListener("focusin", pause); root.addEventListener("focusout", () => queueMicrotask(pause));
    document.addEventListener("visibilitychange", pause);
    pause();
    return () => { observer.disconnect(); document.removeEventListener("pulsy:modal-error", showError, true); window.removeEventListener("resize", relocate); document.removeEventListener("visibilitychange", pause); root.remove(); };
  }, []);
  if (!host) return null;
	return createPortal(
    <>{modal && modalError && <p role="alert" className="m-2 rounded-md border border-destructive p-3 text-sm text-destructive">{modalError}</p>}
		<SonnerToaster
			className="toaster group"
      position={modal ? "top-center" : (i18n?.language ?? "en").split("-")[0] === "ar" ? "bottom-left" : "bottom-right"}
      style={{ "--width": "420px" } as CSSProperties}
      dir={(i18n?.language ?? "en").split("-")[0] === "ar" ? "rtl" : "ltr"}
      offset={{ bottom: "var(--toast-bottom-offset, 96px)", left: "24px", right: "24px", top: "16px" }}
      mobileOffset="16px"
      visibleToasts={3}
      closeButton
			containerAriaLabel={t("nav.notifications")}
			toastOptions={{
				closeButtonAriaLabel: t("actions.close"),
				classNames: {
					toast:
						"group toast !grid !grid-cols-[auto_1fr] !gap-x-3 !gap-y-2 max-w-[min(420px,calc(100vw-32px))] group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-xs border-s-4 data-[type=success]:border-s-success data-[type=error]:border-s-destructive data-[type=warning]:border-s-warning",
          content: "!col-start-2 min-w-0 break-words",
					description: "group-[.toast]:text-muted-foreground",
					actionButton:
						"!col-start-2 !row-start-2 !ms-0 justify-self-start group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
					cancelButton:
						"group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
				},
			}}
			{...props}
		/></>, host
	);
}

export { Toaster };
