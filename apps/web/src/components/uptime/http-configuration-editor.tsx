import { FormField } from "@/components/ui/form-field";
import { Plus, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { parseExpectedStatuses } from "@pulsy/db/http-status-rule";
import { formatMilliseconds } from "@/lib/uptime/number-format";
import { formatLatencyReason } from "@/lib/uptime/format";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { HttpAssertion, HttpConfigurationPatch, HttpConfigurationResult, HttpRequestConfiguration, UptimeMonitorMethod } from "@/types/uptime";
import { extractErrorMessage, extractFieldErrors } from "@/lib/api/extractErrorMessage";

function JsonAssertionValue({ id, value, onChange, invalidMessage }: {
  id: string; value: Extract<HttpAssertion, { type: "json" }>["value"];
  onChange: (value: Extract<HttpAssertion, { type: "json" }>["value"]) => void; invalidMessage: string;
}) {
  const serialized = JSON.stringify(value) ?? "";
  const [draft, setDraft] = useState(serialized);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(serialized); input.current?.setCustomValidity(""); }, [serialized]);
  return <Input validateOnBlur ref={input} id={id} dir="auto" value={draft} onChange={event => {
    setDraft(event.target.value);
    try {
      const parsed: unknown = JSON.parse(event.target.value);
      const scalar = (item: unknown) => item === null || ["string", "number", "boolean"].includes(typeof item);
      if (scalar(parsed) || Array.isArray(parsed) && parsed.length <= 50 && parsed.every(scalar)) {
        event.target.setCustomValidity(""); onChange(parsed as typeof value);
      } else event.target.setCustomValidity(invalidMessage);
    } catch { event.target.setCustomValidity(invalidMessage); }
  }} />;
}

export function HttpConfigurationEditor({ value, onChange, configured, method, expectedStatus, onTest, configurationOnly = false, isEdit = true }: {
  isEdit?: boolean;
  configurationOnly?: boolean;
  value: HttpConfigurationPatch; onChange: (value: HttpConfigurationPatch) => void;
  configured?: boolean; method: UptimeMonitorMethod; expectedStatus: number | string; onTest: (allowPost: boolean) => Promise<HttpConfigurationResult>;
}) {
  const { t, i18n } = useTranslation("uptimeMonitor"); const id = useId();
  const [allowPost, setAllowPost] = useState(false); const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<HttpConfigurationResult | null>(null); const [error, setError] = useState("");
  const rules = value.httpAssertions ?? [];
  const mode = value.requestConfig === undefined ? "retain" : value.requestConfig === null ? "clear" : "replace";
  const request = value.requestConfig ?? { headers: [] };
  const patchRequest = (patch: Partial<HttpRequestConfiguration>) => onChange({ ...value, requestConfig: { ...request, ...patch } });
  const patchRule = (index: number, rule: HttpAssertion) => onChange({ ...value, httpAssertions: rules.map((current, i) => i === index ? rule : current) });

  const test = async () => {
    if (testing) return;
    if (!parseExpectedStatuses(expectedStatus)) { setError(t("httpStatuses.invalid")); return; }
    setTesting(true); setResult(null); setError("");
    try { setResult(await onTest(allowPost)); }
    catch (caught) { setError(extractFieldErrors(caught, ["configuration.url"] as const)["configuration.url"] ?? extractErrorMessage(caught, t("http.testFailed"))); }
    finally { setTesting(false); }
  };
  const ruleSummary = (rule: HttpAssertion) => rule.type === "json" ? `${rule.path} ${t(`http.${rule.op}`)}${rule.op === "exists" ? "" : ` ${JSON.stringify(rule.value)}`}` : `${t(`http.${rule.type}`)} ${"name" in rule ? `${rule.name}: ` : ""}${JSON.stringify(rule.value)}`;
  const summary = [`HTTP ${expectedStatus}`, ...rules.map(ruleSummary)].join(` ${t("http.and")} `);
  return <Collapsible className="min-w-0 rounded-md border">
    <CollapsibleTrigger className="ps-4 break-words">{t("http.title")}</CollapsibleTrigger><CollapsibleContent>
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <p className="text-sm text-muted-foreground">{t("http.description")} <DocsHelpLink docPath="http-checks" /></p>
      <FormField className="form-field"><Label htmlFor={`${id}-redirect`}>{t("http.redirect")}</Label>
        <Select value={value.redirectPolicy ?? "follow"} onValueChange={next => onChange({ ...value, redirectPolicy: next as HttpConfigurationPatch["redirectPolicy"] })}><SelectTrigger id={`${id}-redirect`}><SelectValue /></SelectTrigger><SelectContent>{["follow", "manual", "error"].map(option => <SelectItem key={option} value={String(option)}>{t(`http.redirect_${option}`)}</SelectItem>)}</SelectContent></Select>
      </FormField>
      {!configurationOnly && <>
      {isEdit && <FormField className="form-field"><Label htmlFor={`${id}-secrets`}>{t("http.requestValues")}</Label>
        <Select value={mode} onValueChange={next => onChange({ ...value, requestConfig: next === "retain" ? undefined : next === "clear" ? null : { headers: [] } })}><SelectTrigger id={`${id}-secrets`}><SelectValue /></SelectTrigger><SelectContent>{["retain", "replace", "clear"].map(option => <SelectItem key={option} value={String(option)}>{t(`http.${option}`)}</SelectItem>)}</SelectContent></Select>
        <p className="text-sm text-muted-foreground">{configured ? t("http.stored") : t("http.notStored")}</p>
      </FormField>}
      {(!isEdit || mode === "replace") && <div className="grid min-w-0 grid-cols-1 gap-3">
        {isEdit && <p className="text-sm text-muted-foreground">{t("http.replaceWarning")}</p>}<p className="text-sm text-muted-foreground">{t("creation.requestBounds")}</p>
        {request.headers.map((header, index) => <div key={index} className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <FormField className="form-field"><Label htmlFor={`${id}-h-${index}`}>{t("http.headerName")}</Label><Input validateOnBlur id={`${id}-h-${index}`} required value={header.name} maxLength={128} onChange={event => patchRequest({ headers: request.headers.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /></FormField>
          <FormField className="form-field"><Label htmlFor={`${id}-v-${index}`}>{t("http.headerValue")}</Label><Input validateOnBlur id={`${id}-v-${index}`} type="password" autoComplete="new-password" value={header.value} maxLength={4096} onChange={event => patchRequest({ headers: request.headers.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} /></FormField>
          <Button className="w-full sm:w-auto sm:justify-self-start sm:self-start" type="button" variant="outline" onClick={() => patchRequest({ headers: request.headers.filter((_, i) => i !== index) })}>{t("http.remove")}</Button>
        </div>)}
        <Button type="button" variant="outline" className="w-full sm:w-auto sm:justify-self-start" disabled={request.headers.length >= 20} onClick={() => patchRequest({ headers: [...request.headers, { name: "", value: "" }] })}>{t("http.addHeader")}</Button>
        <FormField className="form-field"><Label htmlFor={`${id}-auth`}>{t("http.auth")}</Label><Select value={request.auth?.type ?? "none"} onValueChange={next => patchRequest({ auth: next === "basic" ? { type: "basic", username: "", password: "" } : next === "bearer" ? { type: "bearer", token: "" } : undefined })}><SelectTrigger id={`${id}-auth`}><SelectValue /></SelectTrigger><SelectContent>{["none", "basic", "bearer"].map(option => <SelectItem value={String(option)} key={option}>{t(`http.auth_${option}`)}</SelectItem>)}</SelectContent></Select></FormField>
        {request.auth?.type === "basic" && <>
          <FormField><Label htmlFor={`${id}-username`}>{t("http.username")}</Label><Input validateOnBlur id={`${id}-username`} autoComplete="off" value={request.auth.username} onChange={event => patchRequest({ auth: { type: "basic", username: event.target.value, password: request.auth?.type === "basic" ? request.auth.password : "" } })} /></FormField>
          <FormField><Label htmlFor={`${id}-password`}>{t("http.password")}</Label><Input validateOnBlur id={`${id}-password`} type="password" autoComplete="new-password" value={request.auth.password} onChange={event => patchRequest({ auth: { type: "basic", username: request.auth?.type === "basic" ? request.auth.username : "", password: event.target.value } })} /></FormField>
        </>}
        {request.auth?.type === "bearer" && <><FormField><Label htmlFor={`${id}-token`}>{t("http.token")}</Label><Input validateOnBlur id={`${id}-token`} type="password" autoComplete="new-password" required value={request.auth.token} onChange={event => patchRequest({ auth: { type: "bearer", token: event.target.value } })} /></FormField></>}
        {method === "POST" && <>
          <FormField><Label htmlFor={`${id}-content`}>{t("http.contentType")}</Label><Input validateOnBlur id={`${id}-content`} placeholder={t("formUX.example", { value: "application/json" })} value={request.contentType ?? ""} maxLength={128} onChange={event => patchRequest({ contentType: event.target.value || undefined })} /></FormField>
          <FormField><Label htmlFor={`${id}-body`}>{t("http.body")}</Label><Textarea id={`${id}-body`} dir="ltr" value={request.body ?? ""} maxLength={65536} onChange={event => patchRequest({ body: event.target.value || undefined })} /></FormField>
        </>}
      </div>}
      </>}
      <p className="break-words text-sm" dir="auto">{summary}</p>
      <p className="text-sm text-muted-foreground">{t("http.paths")}</p><p className="text-sm text-muted-foreground">{t("creation.jsonDistinctions")}</p>
      {rules.map((rule, index) => <Collapsible defaultOpen key={index} className="min-w-0 rounded-md border">
        <div className="flex items-start gap-2 pe-2"><CollapsibleTrigger className="min-w-0 flex-1 ps-4 break-words">{t("http.rule", { number: index + 1 })} · <bdi>{ruleSummary(rule)}</bdi></CollapsibleTrigger><Button type="button" variant="ghost" size="sm" className="my-1 shrink-0 text-destructive hover:text-destructive" onClick={() => onChange({ ...value, httpAssertions: rules.filter((_, i) => i !== index) })}><Trash2 aria-hidden />{t("http.remove")}</Button></div><CollapsibleContent><fieldset className="grid min-w-0 gap-2"><legend className="sr-only">{t("http.rule", { number: index + 1 })}</legend>
        <FormField><Label htmlFor={`${id}-type-${index}`}>{t("http.ruleType")}</Label><Select value={rule.type} onValueChange={next => { const type = next as HttpAssertion["type"]; patchRule(index, type === "json" ? { type, path: "$.status", op: "equals", value: "ok" } : type === "header_contains" || type === "header_equals" ? { type, name: "", value: "" } : { type, value: "" }); }}><SelectTrigger id={`${id}-type-${index}`}><SelectValue /></SelectTrigger><SelectContent>{["json", "body_contains", "body_not_contains", "header_equals", "header_contains"].map(option => <SelectItem key={option} value={String(option)}>{t(`http.${option}`)}</SelectItem>)}</SelectContent></Select></FormField>
        {rule.type === "json" && <>
          <FormField><Label htmlFor={`${id}-path-${index}`}>{t("http.path")}</Label><Input validateOnBlur id={`${id}-path-${index}`} dir="ltr" required maxLength={256} value={rule.path} onChange={event => patchRule(index, { ...rule, path: event.target.value })} /></FormField>
          <FormField><Label htmlFor={`${id}-op-${index}`}>{t("http.operator")}</Label><Select value={rule.op} onValueChange={next => patchRule(index, { ...rule, op: next as typeof rule.op })}><SelectTrigger id={`${id}-op-${index}`}><SelectValue /></SelectTrigger><SelectContent>{["exists", "equals", "not_equals", "lt", "lte", "gt", "gte"].map(option => <SelectItem key={option} value={String(option)}>{t(`http.${option}`)}</SelectItem>)}</SelectContent></Select></FormField>
        </>}
        {"name" in rule && <><FormField><Label htmlFor={`${id}-name-${index}`}>{t("http.headerName")}</Label><Input validateOnBlur id={`${id}-name-${index}`} required value={rule.name} onChange={event => patchRule(index, { ...rule, name: event.target.value })} /></FormField></>}
        {!(rule.type === "json" && rule.op === "exists") && <FormField><Label htmlFor={`${id}-value-${index}`}>{t(rule.type === "json" ? "http.jsonValue" : "http.value")}</Label>
          {rule.type === "json" ? <JsonAssertionValue id={`${id}-value-${index}`} value={rule.value} invalidMessage={t("http.invalidValue")} onChange={next => patchRule(index, { ...rule, value: next })} />
            : <Input validateOnBlur id={`${id}-value-${index}`} dir="auto" value={rule.value} onChange={event => patchRule(index, { ...rule, value: event.target.value })} />}
        </FormField>}
      </fieldset></CollapsibleContent></Collapsible>)}
      <Button type="button" variant="outline" className="w-fit max-w-full justify-self-start whitespace-normal" disabled={rules.length >= 20} onClick={() => onChange({ ...value, httpAssertions: [...rules, { type: "json", path: "$.status", op: "equals", value: "ok" }] })}><Plus aria-hidden />{t("http.addRule")}</Button>
      {!configurationOnly && <>
      {method === "POST" && <Label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={allowPost} onChange={event => setAllowPost(event.target.checked)} className="h-5 w-5 shrink-0" />{t("http.postWarning")}</Label>}
      <Button type="button" variant="secondary" disabled={testing || method === "POST" && !allowPost} onClick={event => { if (event.currentTarget.closest("form")?.reportValidity() !== false) void test(); }} className="mt-4 h-auto min-h-11 w-fit max-w-full justify-self-start whitespace-normal">{testing ? t("http.testing") : t("http.test")}</Button>
      </>}
      <div role="status" className="grid gap-2 break-words text-sm">{error && <p className="text-destructive">{error}</p>}{result && <>
        <p>{t(`status.${result.status}`)} · HTTP {result.httpStatus ?? "—"} · {formatMilliseconds(result.responseTime, i18n.language) ?? "—"}</p>
        {result.latencySample && <p>{t("latency.testNote")}</p>}
        {result.errorMessage && <><p>{t("http.failure")}</p><p dir="auto">{formatLatencyReason(result.errorMessage, t, { httpStatus: result.httpStatus })}</p></>}
        {result.assertionOutcomes?.map(outcome => <p key={outcome.index}>{t("http.rule", { number: outcome.index + 1 })}: {t(`http.result_${outcome.reason}`)}</p>)}
      </>}</div>
    </div>
  </CollapsibleContent></Collapsible>;
}
