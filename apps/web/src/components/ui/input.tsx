import { formattingLocale } from "@/lib/formatting-locale";
import * as React from "react";
import { createPortal } from "react-dom";
import { useFormFieldMessageHost } from "./form-field";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<
	HTMLInputElement,
	React.InputHTMLAttributes<HTMLInputElement> & { validateOnBlur?: boolean }
>(({ className, type, validateOnBlur = false, ...props }, ref) => {
  const { t, i18n } = useTranslation("common");
  const errorId = React.useId();
  const [error, setError] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const messageHost = useFormFieldMessageHost();
  const validate = (field: HTMLInputElement) => {
    if (!validateOnBlur) return;
    const validity = field.validity;
    setError(validity.valid ? "" : validity.valueMissing ? t("nav.requiredField") : validity.customError ? field.validationMessage : validity.rangeUnderflow || validity.rangeOverflow ? t("nav.fieldRange", { min: field.min ? new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(field.min)) : "—", max: field.max ? new Intl.NumberFormat(formattingLocale(i18n.language)).format(Number(field.max)) : "—" }) : t("nav.invalidField"));
  };
	const input = (
		<input
			type={type}
			className={cn(
				"flex h-[var(--control-height)] min-h-[var(--control-height)] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-invalid:border-destructive disabled:bg-muted read-only:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			ref={ref}
			{...props}
      aria-invalid={error ? true : props["aria-invalid"]}
      aria-describedby={[props["aria-describedby"], error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
      onBlur={event => {
        setTouched(true);
        const next = event.relatedTarget;
        // Rendering an inline error during pointerdown can move Submit before
        // pointerup. Let its submit validation render the error and focus it.
        const submitting = next instanceof HTMLButtonElement && next.type === "submit" && next.form === event.currentTarget.form && !!next.form;
        if (!submitting) validate(event.currentTarget);
        props.onBlur?.(event);
      }}
      onChange={event => { if (touched) validate(event.currentTarget); props.onChange?.(event); }}
      onInvalid={event => { setTouched(true); validate(event.currentTarget); props.onInvalid?.(event); }}
		/>
	);
  const message = error ? <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p> : null;
  if (validateOnBlur && messageHost !== undefined) return <>{input}{messageHost && message && createPortal(message, messageHost)}</>;
  return validateOnBlur ? <div className="min-w-0 space-y-2">{input}{message}</div> : input;
});
Input.displayName = "Input";

export { Input };
