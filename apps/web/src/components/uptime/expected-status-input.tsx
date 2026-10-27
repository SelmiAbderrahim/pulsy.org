import { Fragment, useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { parseExpectedStatuses } from "@pulsy/db/http-status-rule";
import { Input } from "@/components/ui/input";
export function ExpectedStatusInput({ id, value, onChange, disabled, ...props }: Omit<ComponentProps<typeof Input>, "type" | "min" | "max" | "validateOnBlur"> & { id: string }) {
  const { t } = useTranslation("uptimeMonitor");
  const input = useRef<HTMLInputElement>(null), [touched, setTouched] = useState(false);
  const invalid = !disabled && !parseExpectedStatuses(String(value ?? ""));
  useEffect(() => { input.current?.setCustomValidity(invalid ? t("httpStatuses.invalid") : ""); }, [invalid, t]);
  return <div className="grid min-w-0 gap-1.5"><Input {...props} ref={input} id={id} type="text" dir="ltr" required disabled={disabled} value={value}
    aria-invalid={touched && invalid || props["aria-invalid"]} aria-describedby={[props["aria-describedby"], `${id}-status-hint`, touched && invalid ? `${id}-status-error` : undefined].filter(Boolean).join(" ")}
    onChange={event => { event.currentTarget.setCustomValidity(parseExpectedStatuses(event.currentTarget.value) ? "" : t("httpStatuses.invalid")); onChange?.(event); }}
    onBlur={event => { setTouched(true); props.onBlur?.(event); }} onInvalid={event => { setTouched(true); props.onInvalid?.(event); }} />
    <p id={`${id}-status-hint`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground"><span>{t("httpStatuses.examplesLabel", "Examples:")}</span>{["200,204", "2xx", "200–299"].map((example, index) => <Fragment key={example}>{" "}<span className="inline-flex items-baseline gap-2 whitespace-nowrap">{index > 0 && <span aria-hidden="true">·</span>}<bdi dir="ltr" className="whitespace-nowrap">{example}</bdi></span></Fragment>)}</p>
    {touched && invalid && <p id={`${id}-status-error`} role="alert" className="text-sm text-destructive">{t("httpStatuses.invalid")}</p>}
  </div>;
}
