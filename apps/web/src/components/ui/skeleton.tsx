import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-md bg-muted", className)} {...props} />;
}
