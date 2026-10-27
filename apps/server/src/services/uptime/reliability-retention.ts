/** Every account uses the operator's history retention, with no account-specific overrides. */
export async function reliabilityRetentionDays(_userId: string, fallbackDays = 30): Promise<number> {
  const configured = Number(process.env.CHECK_LOG_RETENTION_DAYS ?? fallbackDays);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}
