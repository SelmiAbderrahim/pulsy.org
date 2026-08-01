import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateUptimeMonitor } from "@/hooks/uptime";
import { extractErrorMessage } from "@/lib/api/extractErrorMessage";
import type { CreateUptimeMonitorInput, UptimeMonitorMethod } from "@/types/uptime";

interface MonitorCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function MonitorCreateDialog({ open, onOpenChange }: MonitorCreateDialogProps) {
  const { t } = useTranslation("uptimeMonitor");
  const createMutation = useCreateUptimeMonitor();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<UptimeMonitorMethod>("GET");
  const [interval, setInterval] = useState("300");
  const [expectedStatus, setExpectedStatus] = useState("200");
  const [timeout, setTimeout] = useState("10000");
  const [failureThreshold, setFailureThreshold] = useState("3");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const resetForm = () => {
    setName("");
    setUrl("");
    setMethod("GET");
    setInterval("300");
    setExpectedStatus("200");
    setTimeout("10000");
    setFailureThreshold("3");
    setTags([]);
    setTagInput("");
  };

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags([...tags, trimmed]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const input: CreateUptimeMonitorInput = {
      name,
      url,
      method,
      interval: Number(interval),
      expectedStatus: Number(expectedStatus),
      timeout: Number(timeout),
      failureThreshold: Number(failureThreshold),
      tags: tags.length > 0 ? tags : undefined,
    };

    try {
      const created = await createMutation.mutateAsync(input);
      toast.success(t("create.success", "Monitor created successfully"), {
        action: {
          label: t("quickAdd.setupNotifications", "Set up notifications"),
          onClick: () => {
            navigate({
              to: "/dashboard/uptime/$monitorId",
              params: { monitorId: created.uptimeMonitorId },
              search: { tab: "notifications" },
            });
          },
        },
      });
      resetForm();
      onOpenChange(false);
    } catch (error) {
      toast.error(extractErrorMessage(error, t("create.error", "Failed to create monitor")));
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t("create.title", "Create Monitor")}</DialogTitle>
            <DialogDescription>
              {t("create.description", "Add a new URL to monitor for availability.")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">{t("create.fields.name", "Name")}</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("create.fields.namePlaceholder", "My API")}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="url">{t("create.fields.url", "URL")}</Label>
              <Input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t("create.fields.urlPlaceholder", "https://api.example.com/health")}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>{t("create.fields.method", "HTTP Method")}</Label>
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
                <Label>{t("create.fields.interval", "Check Interval")}</Label>
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
                <Label htmlFor="expectedStatus">
                  {t("create.fields.expectedStatus", "Expected Status")}
                </Label>
                <Input
                  id="expectedStatus"
                  type="number"
                  min={100}
                  max={599}
                  value={expectedStatus}
                  onChange={(e) => setExpectedStatus(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="timeout">
                  {t("create.fields.timeout", "Timeout")}
                </Label>
                <Input
                  id="timeout"
                  type="number"
                  min={1000}
                  max={60000}
                  step={1000}
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="failureThreshold">
                  {t("create.fields.failureThreshold", "Threshold")}
                </Label>
                <Input
                  id="failureThreshold"
                  type="number"
                  min={1}
                  max={10}
                  value={failureThreshold}
                  onChange={(e) => setFailureThreshold(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tags">{t("tags.label", "Tags")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={handleAddTag}
                  placeholder={t("tags.placeholder", "Add a tag...")}
                  disabled={tags.length >= 10}
                />
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="min-h-[44px] gap-1 ps-3 pe-0">
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="inline-flex h-[44px] w-[44px] items-center justify-center rounded-md hover:bg-muted"
                        aria-label={t("tags.remove", {
                          defaultValue: "Remove {{tag}}",
                          tag,
                        })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-[44px] w-full sm:w-auto"
            >
              {t("actions.cancel", "Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              className="h-[44px] w-full sm:w-auto"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
              )}
              {t("actions.createMonitor", "New Monitor")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
