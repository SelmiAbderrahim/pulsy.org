import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";
const MessageHost = React.createContext<HTMLDivElement | null | undefined>(undefined);
/** Inputs keep their own error state but render feedback in the field's message stack. */
export const useFormFieldMessageHost = () => React.useContext(MessageHost);
type ControlProps = { id?: string; "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"] };
export interface FormFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  control?: React.ReactElement<ControlProps>;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  controlId?: string;
}
function flattenChildren(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).flatMap(child =>
    React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment
      ? flattenChildren(child.props.children) : [child]);
}

/** Label → control → one help/error stack. Composed fields retain their own IDs. */
export const FormField = React.forwardRef<HTMLDivElement, FormFieldProps>(
  ({ label, control, helper, error, controlId, className, children, ...props }, ref) => {
    const generatedId = React.useId();
    const [messageHost, setMessageHost] = React.useState<HTMLDivElement | null>(null);
    if (!control) {
      const nodes = flattenChildren(children);
      const isMessage = (node: React.ReactNode) => React.isValidElement<{ role?: string }>(node)
        && (node.type === "p" || node.type === "small" || node.props.role === "alert");
      const messages = nodes.filter(isMessage);
      const isError = (message: React.ReactNode) => React.isValidElement<{ role?: string; className?: string }>(message)
        && (message.props.role === "alert" || message.props.className?.split(/\s+/).includes("text-destructive"));
      return <MessageHost.Provider value={messageHost}><div ref={ref} className={cn("form-field", className)} {...props}>
        {nodes.filter(node => !isMessage(node)).map((node, index) => <React.Fragment key={`field-node-${index}`}>{node}</React.Fragment>)}
        <div ref={setMessageHost} data-form-messages className="grid min-w-0 gap-1.5 empty:hidden">
          {messages.filter(message => !isError(message)).map((message, index) => <React.Fragment key={`help-${index}`}>{message}</React.Fragment>)}
          {messages.filter(isError).map((message, index) => <React.Fragment key={`error-${index}`}>{message}</React.Fragment>)}
        </div>
      </div></MessageHost.Provider>;
    }
    const id = controlId ?? control.props.id ?? generatedId;
    const description = [control.props["aria-describedby"], helper ? `${id}-helper` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
    return <MessageHost.Provider value={messageHost}><div ref={ref} className={cn("grid min-w-0 items-start", className)} {...props}>
      <Label htmlFor={id} className="mb-1.5">{label}</Label>
      {React.cloneElement(control, { id, "aria-describedby": description, "aria-invalid": error ? true : control.props["aria-invalid"] })}
      <div ref={setMessageHost} data-form-messages className="mt-1.5 grid items-start gap-1.5 text-sm empty:hidden">
        {helper && <p id={`${id}-helper`} className="text-muted-foreground">{helper}</p>}
        {error && <p id={`${id}-error`} role="alert" className="text-destructive">{error}</p>}
      </div>
    </div></MessageHost.Provider>;
  },
);
FormField.displayName = "FormField";
