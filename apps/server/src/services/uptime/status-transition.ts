import type { HttpCheckResult } from "./checker-service";
import type { UptimeMonitor } from "./monitor-service";

type MonitorStatus = UptimeMonitor["status"];
type CheckStatus = HttpCheckResult["status"];

interface TransitionInput {
	previousStatus: MonitorStatus;
	checkStatus: CheckStatus;
	consecutiveFailures: number;
	failureThreshold: number;
}

interface TransitionDecision {
	consecutiveFailures: number;
	monitorStatus: MonitorStatus;
	shouldRecordStatusChange: boolean;
	statusAfter: CheckStatus;
	shouldCreateIncident: boolean;
	shouldResolveIncident: boolean;
}

export function computeStatusTransition({
	previousStatus,
	checkStatus,
	consecutiveFailures,
	failureThreshold,
}: TransitionInput): TransitionDecision {
	const nextConsecutiveFailures =
		checkStatus === "down" ? consecutiveFailures + 1 : 0;

	if (checkStatus === "down") {
		const thresholdReached = nextConsecutiveFailures >= failureThreshold;
		const monitorStatus = thresholdReached ? "down" : previousStatus;
		const shouldCreateIncident = thresholdReached && previousStatus !== "down";

		return {
			consecutiveFailures: nextConsecutiveFailures,
			monitorStatus,
			shouldRecordStatusChange: shouldCreateIncident,
			statusAfter: "down",
			shouldCreateIncident,
			shouldResolveIncident: false,
		};
	}

	if (checkStatus === "up") {
		const shouldResolveIncident =
			previousStatus !== "pending" && previousStatus !== "up";

		return {
			consecutiveFailures: 0,
			monitorStatus: "up",
			shouldRecordStatusChange: shouldResolveIncident,
			statusAfter: "up",
			shouldCreateIncident: false,
			shouldResolveIncident,
		};
	}

	const shouldRecordStatusChange =
		previousStatus !== "pending" && previousStatus !== "degraded";

	return {
		consecutiveFailures: 0,
		monitorStatus: "degraded",
		shouldRecordStatusChange,
		statusAfter: "degraded",
		shouldCreateIncident: false,
		shouldResolveIncident: false,
	};
}
