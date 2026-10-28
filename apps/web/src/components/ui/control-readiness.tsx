import { Children, cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

/** Server markup and the first hydration render must not advertise a working trigger. */
export function useControlReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

type TriggerProps = { asChild?: boolean; disabled?: boolean; children?: ReactNode };

/** Keep the child's accessible name and a single Radix Slot child while showing readiness. */
export function useReadyTriggerProps({ asChild, disabled, children }: TriggerProps) {
  const ready = useControlReady();
  const spinner = !ready && <Loader2 aria-hidden="true" className="ms-2 h-4 w-4 shrink-0 animate-spin" />;
  if (asChild && isValidElement(children)) {
    const child = Children.only(children) as ReactElement<TriggerProps>;
    return {
      disabled: disabled || child.props.disabled || !ready,
      "aria-busy": !ready || undefined,
      children: cloneElement(child, { disabled: disabled || child.props.disabled || !ready }, <>{child.props.children}{spinner}</>),
    };
  }
  return { disabled: disabled || !ready, "aria-busy": !ready || undefined, children: <>{children}{spinner}</> };
}
