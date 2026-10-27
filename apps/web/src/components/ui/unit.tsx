import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const arabicScript = /[؀-ۿݐ-ݿࢠ-ࣿ]/;

/**
 * One formatted measurement ("350 ms", "99.50%", "5 s") rendered as a single
 * unbreakable, bidi-isolated token. Latin-symbol units read left-to-right even
 * inside Arabic text (`dir="ltr"`); a quantity whose unit is written in Arabic
 * script keeps its own direction so the unit is not visually reversed.
 * Missing values (`null`) render the dash used everywhere else.
 */
export function Unit({ children, className }: { children: ReactNode; className?: string }) {
  const text = typeof children === "string" ? children : null;
  if (children == null || text === "") return <span className={className}>—</span>;
  return (
    <bdi dir={text && arabicScript.test(text) ? undefined : "ltr"} className={cn("whitespace-nowrap tabular-nums", className)}>
      {children}
    </bdi>
  );
}
