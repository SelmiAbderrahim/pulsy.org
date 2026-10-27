import { useState, type ComponentPropsWithoutRef } from 'react';
import { Command } from 'cmdk';
import { useControlReady } from './control-readiness';
import { Check, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { ControlChevron, controlTriggerClasses, type ControlSize } from './select';
export type ComboboxOption = { value: string; label: string; description?: string; disabled?: boolean };
export type ComboboxProps = Omit<ComponentPropsWithoutRef<'button'>,'value'|'onChange'|'size'> & {
  value: string; onValueChange: (value:string)=>void; options: ComboboxOption[]; size?: ControlSize; placeholder?:string;
};
export function Combobox({value,onValueChange,options,size='default',placeholder,className,...props}:ComboboxProps){
  const ready=useControlReady();
  const {t}=useTranslation('common');const [open,setOpen]=useState(false);
  const selected=options.find(option=>option.value===value);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" role="combobox" aria-expanded={open} aria-haspopup="dialog" className={cn(controlTriggerClasses(size),className)} {...props} disabled={props.disabled||!ready} aria-busy={!ready||undefined} onKeyDown={event=>{props.onKeyDown?.(event);if(!event.defaultPrevented && ["ArrowDown","ArrowUp"].includes(event.key)){event.preventDefault();setOpen(true);}}}><span className="truncate">{selected?.label ?? placeholder ?? t('controls.choose')}</span><ControlChevron pending={!ready}/></button></PopoverTrigger>
    <PopoverContent aria-label={t("controls.search")} className="w-[var(--radix-popover-trigger-width)] min-w-[min(16rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden">
      <Command label={t("controls.search")} defaultValue={value} loop>
        <div className="flex items-center gap-2 border-b px-3"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/><Command.Input aria-label={t('controls.search')} placeholder={t('controls.search')} className="h-11 min-w-0 flex-1 bg-background text-sm outline-hidden"/></div>
        <Command.List aria-label={t("controls.choose")} className="max-h-[min(320px,var(--radix-popover-content-available-height))] overflow-y-auto p-1">
          <Command.Empty className="p-4 text-sm text-muted-foreground">{t('controls.noResults')}</Command.Empty>
          {options.map(option=><Command.Item key={option.value} value={option.value} keywords={[option.label]} disabled={option.disabled} onSelect={()=>{onValueChange(option.value);setOpen(false);}} className="relative flex min-h-[40px] cursor-default items-center rounded-xs px-3 ps-8 py-2 text-sm outline-hidden data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50">
            {option.value===value&&<Check aria-hidden="true" className="absolute start-2.5 size-4"/>}<span className="min-w-0 break-words">{option.label}{option.description&&<span className="block text-xs text-muted-foreground">{option.description}</span>}</span>
          </Command.Item>)}
        </Command.List>
      </Command>
    </PopoverContent>
  </Popover>;
}
