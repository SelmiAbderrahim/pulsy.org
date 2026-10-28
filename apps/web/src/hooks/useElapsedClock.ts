import { useEffect, useState } from "react";

/** One quiet clock per visible collection, shared by all its ongoing incidents. */
export function useElapsedClock(enabled: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const update = () => { if (document.visibilityState !== "hidden") setNow(Date.now()); };
    update();
    const timer = window.setInterval(update, 15_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, [enabled]);
  return now;
}
