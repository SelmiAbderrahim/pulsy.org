import { forwardRef, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export const PasswordInput = forwardRef<HTMLInputElement, Omit<ComponentProps<typeof Input>, "type">>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation("auth");
    const [visible, setVisible] = useState(false);
    return <div className="relative min-w-0">
      <Input {...props} ref={ref} type={visible ? "text" : "password"} className={cn("pe-12", className)} />
      <Button type="button" variant="ghost" size="icon" className="absolute end-0 top-0 size-11" disabled={props.disabled} aria-label={t(visible ? "ux.hidePassword" : "ux.showPassword")} aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff /> : <Eye />}</Button>
    </div>;
  },
);
PasswordInput.displayName = "PasswordInput";
