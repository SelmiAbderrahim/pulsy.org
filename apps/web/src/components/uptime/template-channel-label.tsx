import { useTranslation } from "react-i18next";
import type { TemplateChannelOption } from "@/types/monitor-templates";

/** Only display the server-provided masked destination; identifiers remain inspectable. */
export function TemplateChannelLabel({ channel }: { channel: TemplateChannelOption }) {
  const { t } = useTranslation("uptimeMonitor");
  return <span title={channel.id} className="min-w-0 break-words">
    {t(`notifications.channelTypes.${channel.type}`, channel.type)}
    {channel.destination && <> · <bdi>{channel.destination}</bdi></>}
    {" · "}{t(channel.monitorId ? "templates.monitorChannel" : "templates.defaultChannel")}
  </span>;
}
