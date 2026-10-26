import { z } from "zod";

/** Standard choices; previously saved valid custom intervals remain supported. */
export const SERVER_REPORTING_INTERVALS = [60, 120, 300, 600, 1800, 3600] as const;
export const apiServerReportingInterval = z.number().int().min(60).max(3600);
