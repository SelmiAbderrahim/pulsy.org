import { MAX_MONITOR_TIMEOUT_MS } from "@pulsy/db/monitor-defaults";
import { connect, isIP, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import { assertAllowedHostname, resolveAndPin, SsrfBlockedError, type EgressResolver } from "./ssrf";
const invalid = () => Object.assign(new Error("Outbound destination is unavailable or prohibited"), { code: "EDESTINATION" });
const timedOut = () => Object.assign(new Error("Outbound connection deadline exceeded"), { code: "ETIMEDOUT" });
function normalizedHost(raw: string) {
  if (!raw || raw.length > 253 || /[\s/@?#\\]/.test(raw)) throw invalid();
  const literal = raw.replace(/^\[|\]$/g, "");
  if (isIP(literal)) return literal;
  if (raw.includes(":")) throw invalid();
  try {
    const url = new URL(`http://${raw}`);
    if (!url.hostname || url.port || url.username || url.password || url.pathname !== "/") throw invalid();
    return url.hostname;
  } catch { throw invalid(); }
}
/** Resolve once, validate all answers, then connect only to the chosen numeric IP. */
export async function connectOutboundSocket(rawHost: string, port: number, timeoutMs: number, secure = false, resolver?: EgressResolver): Promise<Socket | TLSSocket> {
  const host = normalizedHost(rawHost);
  try { assertAllowedHostname(host, rawHost); } catch { throw invalid(); }
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_MONITOR_TIMEOUT_MS) throw invalid();
  let socket: Socket | TLSSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const work = async () => {
    // one pinned destination/attempt; add bounded address fallback
    // when dual-stack failure measurements justify it.
    let target: { address: string; family: number };
    try { target = await resolveAndPin(host, resolver); }
    catch (error) { if (error instanceof SsrfBlockedError || (error as { code?: string }).code === "ENOTFOUND" && !(error as { syscall?: string }).syscall) throw invalid(); throw error; }
    if (expired) throw timedOut();
    socket = secure
      ? connectTls({ host: target.address, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: true })
      : connect({ host: target.address, family: target.family, port });
    const connected = socket;
    await new Promise<void>((resolve, reject) => {
      // Retain the error observer until close, including the handoff to the caller.
      connected.once(secure ? "secureConnect" : "connect", resolve);
      connected.once("error", reject);
    });
    return connected;
  };
  try {
    return await Promise.race([work(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { expired = true; socket?.destroy(); reject(timedOut()); }, timeoutMs);
    })]);
  } catch (error) { socket?.destroy(); throw error; }
  finally { if (timer) clearTimeout(timer); }
}
