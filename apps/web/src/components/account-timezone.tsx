import { createContext, useContext, type ReactNode } from "react";
import { browserTimezone } from "@pulsy/db/timezone";
import { useConfig } from "@/hooks/useConfig";

const Timezone = createContext(browserTimezone());
export const useAccountTimezone = () => useContext(Timezone);
export function AccountTimezoneProvider({ children }: { children: ReactNode }) {
  const { data } = useConfig();
  return <Timezone.Provider value={data?.timezone ?? browserTimezone()}>{children}</Timezone.Provider>;
}
