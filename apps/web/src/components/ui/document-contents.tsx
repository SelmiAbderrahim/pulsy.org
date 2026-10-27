import { useEffect, useRef, useState } from "react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";

/** The same responsive, keyboard-accessible contents navigation for Help and API docs. */
export function DocumentContents({ title, items }: { title: string; items: { id: string; title: string }[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const selectedDestination = useRef<HTMLElement | null>(null);
  const ids = items.map(item => item.id).join("\n");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const headings = ids.split("\n").map(id => document.getElementById(id)).filter((node): node is HTMLElement => Boolean(node));
        const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 64;
        const reached = headings.filter(node => node.getBoundingClientRect().top <= offset + 100);
        const current = reached.at(-1) ?? headings[0];
        if (current) setActive(current.id);
      });
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("hashchange", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("hashchange", update);
    };
  }, [ids]);
  if (!items.length) return null;
  return <nav aria-label={title} className="sticky top-[calc(var(--header-height)+8px)] z-20 min-w-0 rounded-lg border bg-card p-3 lg:max-h-[calc(100dvh-var(--header-height)-2rem)] lg:overflow-y-auto">
    <p className="mb-2 hidden text-sm font-medium text-muted-foreground lg:block">{title}</p>
    <Select value={active} onOpenChange={open => { if (open) selectedDestination.current = null; }} onValueChange={value => {
      const target = document.getElementById(value);
      if (target) { selectedDestination.current = target; location.hash = value; setActive(value); }
    }}>
      <SelectTrigger aria-label={title} className="lg:hidden"><SelectValue placeholder={title} /></SelectTrigger>
      <SelectContent onCloseAutoFocus={event => {
        const target = selectedDestination.current;
        selectedDestination.current = null;
        if (target?.isConnected) { event.preventDefault(); target.tabIndex = -1; target.focus({ preventScroll: true }); }
      }}>{items.map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent>
    </Select>
    <ul className="hidden gap-1 text-sm lg:grid">{items.map(item => <li key={item.id}><a href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined} className={`inline-flex min-h-11 min-w-11 items-center rounded-md px-2 underline-offset-4 hover:underline ${active === item.id ? "bg-muted font-semibold text-foreground" : "text-primary"}`}>{item.title}</a></li>)}</ul>
  </nav>;
}
