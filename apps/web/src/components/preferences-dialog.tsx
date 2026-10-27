import { FormField } from "@/components/ui/form-field";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { browserTimezone, isValidTimezone } from "@pulsy/db/timezone";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/locales";
import { useConfig, type AppConfig } from "@/hooks/useConfig";
import { useSession } from "@/lib/auth-client";
import { trpcMutation } from "@/lib/api/trpc";
import { isSessionClientActive } from "@/lib/session-query-client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FormFooter } from "@/components/ui/form-footer";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LanguageCombobox } from "@/components/ui/language-combobox";
import { TimezoneCombobox } from "@/components/ui/timezone-combobox";

interface PreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLanguageChange: (language: SupportedLanguage) => Promise<void>;
}
export function PreferencesDialog({ open, onOpenChange, onLanguageChange }: PreferencesDialogProps) {
  const { t, i18n } = useTranslation("common");
  const { data: session } = useSession();
  const { data, isPending, error: configError, refetch } = useConfig();
  const client = useQueryClient();
  const language = (i18n.resolvedLanguage ?? i18n.language ?? "en").split("-")[0] as SupportedLanguage;
  const [draft, setDraft] = useState<{ language: SupportedLanguage; timezone: string | null } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const pending = useRef(false);
  const values = draft ?? { language, timezone: data?.timezone ?? null };
  const valid = (values.timezone === null || isValidTimezone(values.timezone)) && SUPPORTED_LANGUAGES.includes(values.language);
  const dirty = values.language !== language || values.timezone !== (data?.timezone ?? null);
  useEffect(() => { if (!open) { setDraft(null); setError(false); } }, [open]);
  const close = (next: boolean) => { if (!pending.current) onOpenChange(next); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || isPending || configError || !valid || !dirty) return;
    pending.current = true; setBusy(true); setError(false);
    try {
      if (values.timezone !== (data?.timezone ?? null)) {
        await trpcMutation("config", "setTimezone", { timezone: values.timezone });
        if (!isSessionClientActive(client)) return;
        client.setQueryData<AppConfig>(["config", session?.user.id], previous => ({ ...previous, requireEmailVerification: previous?.requireEmailVerification ?? data?.requireEmailVerification ?? false, timezone: values.timezone }));
      }
      if (!isSessionClientActive(client)) return;
      if (values.language !== language) await onLanguageChange(values.language);
      if (!isSessionClientActive(client)) return;
      setDraft(null); onOpenChange(false);
    } catch { setError(true); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={close}><DialogContent hasUnsavedChanges={dirty} className="sm:max-w-[var(--dialog-simple)]">
    <DialogHeader><DialogTitle>{t("nav.preferences")}</DialogTitle><DialogDescription>{t("preferences.description")}</DialogDescription></DialogHeader>
    <form onSubmit={event => void save(event)} className="grid gap-4">
      <FormField className="form-field"><Label htmlFor="preferences-language">{t("nav.language")}</Label><LanguageCombobox id="preferences-language" value={values.language} onValueChange={value => setDraft({ ...values, language: value as SupportedLanguage })} disabled={busy || isPending || !!configError} aria-describedby="preferences-language-help" /><p id="preferences-language-help" className="text-sm text-muted-foreground">{t("preferences.languageHint")}</p></FormField>
      <FormField className="form-field"><Label htmlFor="preferences-timezone">{t("nav.timezone")}</Label><TimezoneCombobox id="preferences-timezone" value={values.timezone ?? browserTimezone()} onValueChange={timezone => setDraft({ ...values, timezone })} disabled={busy || isPending || !!configError} aria-invalid={!valid} aria-describedby="preferences-timezone-help" /><p id="preferences-timezone-help" className={valid ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{t(valid ? "nav.timezoneHint" : "nav.timezoneInvalid")}</p></FormField>
      <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={values.timezone === null} onCheckedChange={checked => setDraft({ ...values, timezone: checked === true ? null : browserTimezone() })} disabled={busy || isPending || !!configError} />{t("preferences.useBrowserTimezone")}</label>
      {configError && <div role="alert" className="grid gap-2"><p className="text-sm text-destructive">{t("states.error")}</p><Button type="button" variant="outline" className="w-full sm:w-auto sm:justify-self-start" onClick={() => void refetch()}>{t("actions.retry")}</Button></div>}
      {error && <p role="alert" className="text-sm text-destructive">{t("preferences.saveError")}</p>}
      <FormFooter><Button type="button" variant="secondary" data-dialog-discard disabled={busy} onClick={() => close(false)}>{t("actions.cancel")}</Button><Button type="submit" disabled={busy || isPending || !!configError || !valid || !dirty}>{busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}{t("actions.save")}</Button></FormFooter>
    </form>
  </DialogContent></Dialog>;
}
