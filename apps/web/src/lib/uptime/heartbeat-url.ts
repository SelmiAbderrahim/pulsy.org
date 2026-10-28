/** Capability URLs are credentials. Keep masked until an explicit reveal/copy action. */
export function heartbeatUrl(server: string, origin: string, token: string, event: "start" | "fail" | "success" = "success") {
  return new URL(`${server.replace(/\/$/, "")}/api/heartbeat/${encodeURIComponent(token)}/${event}`, origin).href;
}
/**
 * Cron-friendly commands. Pings need no body and no content type: a plain GET
 * (`curl -fsS`) records the event; POST and HEAD are accepted too.
 */
export function heartbeatExamples(server: string, origin: string, token: string | null) {
  const endpoint = heartbeatUrl(server, origin, token ?? "YOUR_TOKEN");
  const at = (event: "start" | "fail" | "success") => endpoint.replace(/\/success$/, `/${event}`);
  return [
    `curl -fsS -m 10 --retry 3 "${endpoint}"`,
    `curl -fsS -m 10 --retry 3 "${at("start")}"`,
    `curl -fsS -m 10 --retry 3 "${at("fail")}"`,
    `wget -q -O /dev/null "${endpoint}"`,
  ].join("\n\n");
}
