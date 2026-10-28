import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { ServerHealthService } from "@/services/uptime/serverHealthService";
import { uptimeKeys } from "./queryKeys";
export function useServerHealth(monitorId: string) {
  const { data: session } = useSession();
  return useQuery({ queryKey: uptimeKeys.server.detail(monitorId, session?.user.id), queryFn: () => ServerHealthService.one(monitorId), enabled: !!monitorId && !!session?.user.id, refetchInterval: 15000 });
}
export function useServerHistory(monitorId: string, hours: number, enabled = true) {
  const { data: session } = useSession();
  return useQuery({ queryKey: uptimeKeys.server.history(monitorId, hours, session?.user.id), queryFn: () => ServerHealthService.history(monitorId, hours), enabled: enabled && !!monitorId && !!session?.user.id, refetchInterval: 15000 });
}
