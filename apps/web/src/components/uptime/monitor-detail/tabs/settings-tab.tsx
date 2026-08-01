import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateUptimeMonitor } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { UptimeMonitor, UptimeMonitorMethod } from "@/types/uptime";

interface SettingsTabProps {
  monitor: UptimeMonitor;
}

const ALL_INTERVALS = [
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
];

const METHODS: UptimeMonitorMethod[] = ["GET", "HEAD", "POST"];

export function SettingsTab({ monitor }: SettingsTabProps) {
  const { t } = useTranslation("uptimeMonitor");
  const updateMutation = useUpdateUptimeMonitor();

  const [name, setName] = useState(monitor.name);
  const [url, setUrl] = useState(monitor.url);
  const [method, setMethod] = useState<UptimeMonitorMethod>(monitor.method);
  const [interval, setInterval] = useState(String(monitor.interval));
  const [expectedStatus, setExpectedStatus] = useState(String(monitor.expectedStatus));
  const [timeout, setTimeout] = useState(String(monitor.timeout));
  const [failureThreshold, setFailureThreshold] = useState(String(monitor.failureThreshold));

  useEffect(() => {
    setName(monitor.name);
    setUrl(monitor.url);
    setMethod(monitor.method);
    setInterval(String(monitor.interval));
    setExpectedStatus(String(monitor.expectedStatus));
    setTimeout(String(monitor.timeout));
    setFailureThreshold(String(monitor.failureThreshold));
  }, [monitor]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateMutation.mutateAsync({
        uptimeMonitorId: monitor.uptimeMonitorId,
        name,
        url,
        method,
        interval: Number(interval),
        expectedStatus: Number(expectedStatus),
        timeout: Number(timeout),
        failureThreshold: Number(failureThreshold),
      });
      toast.success(t("edit.success", "Monitor updated successfully"));
    } catch (error) {
      toast.error(extractErrorMessage(error, t("edit.error", "Failed to update monitor")));
    }
  };

  return (
    <>
    <form onSubmit={handleSave}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {t("edit.title", "Edit Monitor")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="settings-name">{t("create.fields.name")}</Label>
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="settings-url">{t("create.fields.url")}</Label>
            <Input
              id="settings-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("create.fields.method")}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as UptimeMonitorMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t("create.fields.interval")}</Label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_INTERVALS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {t(`intervals.${i.value}`, i.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="settings-expected">{t("create.fields.expectedStatus")}</Label>
              <Input
                id="settings-expected"
                type="number"
                min={100}
                max={599}
                value={expectedStatus}
                onChange={(e) => setExpectedStatus(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-timeout">{t("create.fields.timeout")}</Label>
              <Input
                id="settings-timeout"
                type="number"
                min={1000}
                max={60000}
                step={1000}
                value={timeout}
                onChange={(e) => setTimeout(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="settings-threshold">{t("create.fields.failureThreshold")}</Label>
              <Input
                id="settings-threshold"
                type="number"
                min={1}
                max={10}
                value={failureThreshold}
                onChange={(e) => setFailureThreshold(e.target.value)}
              />
            </div>
          </div>

          {/* TLS Monitoring */}
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label>
                {t("tlsMonitoring.title", "TLS Certificate Monitoring")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t(
                  "tlsMonitoring.description",
                  "Monitor TLS certificate expiry for HTTPS endpoints",
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="gap-1.5 border-success/30 bg-success/10 text-success"
              >
                {t("tlsMonitoring.active", "Active")}
              </Badge>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            type="submit"
            disabled={updateMutation.isPending}
            className="h-[44px]"
          >
            {updateMutation.isPending && (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            )}
            {t("actions.save", "Save")}
          </Button>
        </CardFooter>
      </Card>
    </form>
    </>
  );
}
