import { useState, useRef, type ComponentPropsWithoutRef } from 'react';
import { DayPicker } from 'react-day-picker';
import { enUS, ar, fr, de, es } from 'react-day-picker/locale';
import { useControlReady } from './control-readiness';
import { CalendarDays, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { Popover, PopoverTrigger, PopoverContent } from './popover';
import { controlTriggerClasses, type ControlSize } from './select';
import { Button } from './button';
const locales={en:enUS,ar,fr,de,es};
function day(value?:string){if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return undefined;const [y,m,d]=value.split('-').map(Number);const date=new Date(y!,m!-1,d!,12);return date.getFullYear()===y&&date.getMonth()===m!-1&&date.getDate()===d?date:undefined;}
function dayValue(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export type DatePickerProps=Omit<ComponentPropsWithoutRef<'button'>,'value'|'onChange'|'size'> & {value?:string;onValueChange:(value:string|undefined)=>void;min?:string;max?:string;size?:ControlSize};
export function DatePicker({value,onValueChange,min,max,size='default',className,...props}:DatePickerProps){
  const ready=useControlReady();
  const calendar = useRef<HTMLDivElement>(null);
  const {t,i18n}=useTranslation('common');const [open,setOpen]=useState(false);const locale=i18n?.language?.split('-')[0] as keyof typeof locales;const selected=day(value),first=day(min),last=day(max);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" className={cn(controlTriggerClasses(size),className)} {...props} data-draft-control="" data-draft-value={value ?? ""} disabled={props.disabled||!ready} aria-busy={!ready||undefined}><span className="truncate">{selected?formatDate(value!,i18n.language,'UTC',{dateStyle:'medium'}):t('controls.chooseDate')}</span><span data-control-icon className="pointer-events-none absolute end-3 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center">{ready?<CalendarDays aria-hidden="true" className="size-4 text-muted-foreground"/>:<Loader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground"/>}</span></button></PopoverTrigger>
    <PopoverContent ref={calendar} onOpenAutoFocus={event => { event.preventDefault(); const root = calendar.current; const target = root?.querySelector<HTMLButtonElement>('[data-selected] button:not(:disabled)') ?? root?.querySelector<HTMLButtonElement>('[data-today] button:not(:disabled)') ?? root?.querySelector<HTMLButtonElement>('[data-day] button:not(:disabled)'); target?.focus(); }} aria-label={t('controls.chooseDate')} className="p-3">
      <DayPicker mode="single" autoFocus selected={selected} defaultMonth={selected??first} startMonth={first} endMonth={last} disabled={[...(first?[{before:first}]:[]),...(last?[{after:last}]:[])]} locale={locales[locale]??enUS} dir={locale==='ar'?'rtl':'ltr'} onSelect={date=>{onValueChange(date?dayValue(date):undefined);setOpen(false);}}
        labels={{labelNext:()=>t('controls.nextMonth'),labelPrevious:()=>t('controls.previousMonth'),labelGrid:date=>formatDate(date,i18n.language,undefined,{month:'long',year:'numeric'}),labelDayButton:date=>formatDate(date,i18n.language,undefined,{dateStyle:'full'})}}
        classNames={{root:'relative text-sm',months:'flex flex-col',month:'space-y-3',month_caption:'flex h-11 items-center justify-center px-10 font-medium',nav:'absolute inset-x-0 top-0 flex justify-between',button_previous:'flex size-11 items-center justify-center rounded-md hover:bg-accent aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',button_next:'flex size-11 items-center justify-center rounded-md hover:bg-accent aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',chevron:'size-4 fill-current rtl:scale-x-[-1]',month_grid:'w-full border-collapse',weekdays:'',weekday:'size-9 text-xs font-normal text-muted-foreground',day:'size-9 p-0 text-center',day_button:'size-9 rounded-md hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',selected:'bg-primary text-primary-foreground rounded-md [&>button:hover]:bg-primary',today:'font-semibold underline',outside:'text-muted-foreground',disabled:'[&>button]:bg-muted [&>button]:text-muted-foreground [&>button]:cursor-not-allowed',hidden:'invisible'}}/>
      <div className="mt-3 flex justify-end border-t pt-3"><Button type="button" variant="ghost" disabled={!value} onClick={()=>{onValueChange(undefined);setOpen(false);}}>{t('controls.clearDate')}</Button></div>
    </PopoverContent>
  </Popover>;
}
