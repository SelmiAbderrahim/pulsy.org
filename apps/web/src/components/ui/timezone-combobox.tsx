import { isValidTimezone } from "@pulsy/db/timezone";
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTimezone } from '@/lib/date-format';
import { Combobox, type ComboboxProps } from './combobox';
export function TimezoneCombobox(props:Omit<ComboboxProps,'options'>){
  const {i18n}=useTranslation();
  const options=useMemo(()=>[...new Set(['UTC',...Intl.supportedValuesOf('timeZone'),...(props.value?[props.value]:[])])].sort().map(zone=>({value:zone,label:isValidTimezone(zone)?formatTimezone(zone,i18n.language):zone,disabled:!isValidTimezone(zone)})),[i18n.language,props.value]);
  return <Combobox {...props} options={options}/>;
}
