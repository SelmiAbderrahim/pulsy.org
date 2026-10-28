import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MaintenanceService } from "@/services/uptime/maintenanceService";
import { uptimeKeys } from "./queryKeys";

export function useMaintenance() {
  return useQuery({ queryKey: uptimeKeys.maintenance.all(), queryFn: MaintenanceService.list, refetchInterval: 30_000 });
}
export function useMaintenanceActions() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: uptimeKeys.all() });
  return {
    create: useMutation({ mutationFn: MaintenanceService.create, onSuccess: invalidate }),
    update: useMutation({ mutationFn: MaintenanceService.update, onSuccess: invalidate }),
    snooze: useMutation({ mutationFn: MaintenanceService.snooze, onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: MaintenanceService.cancel, onSuccess: invalidate }),
    resume: useMutation({ mutationFn: MaintenanceService.resume, onSuccess: invalidate }),
    preview: useMutation({ mutationFn: MaintenanceService.preview }),
  };
}
