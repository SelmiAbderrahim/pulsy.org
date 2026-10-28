import { formattingLocale } from "@/lib/formatting-locale";
import { useId, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from './button';
export type FileDropzoneProps=Omit<ComponentPropsWithoutRef<'button'>,'value'|'onChange'> & {value:File|null;onChange:(file:File|null)=>void;accept:string;error?:string};
export function FileDropzone({value,onChange,accept,error,className,...props}:FileDropzoneProps){
  const {t,i18n}=useTranslation('common');const id=useId(),input=useRef<HTMLInputElement>(null),chooser=useRef<HTMLButtonElement>(null);const [invalid,setInvalid]=useState(''),[dragging,setDragging]=useState(false);
  const message=error||invalid;
  const choose=(file?:File)=>{if(!file)return;const allowed=accept.split(',').map(type=>type.trim().toLowerCase()).filter(Boolean);const name=file.name.toLowerCase(),type=file.type.toLowerCase();if(allowed.length&&!allowed.some(rule=>rule.startsWith('.')?name.endsWith(rule):rule.endsWith('/*')?type.startsWith(rule.slice(0,-1)):type===rule)){setInvalid(t('controls.fileType',{types:accept}));return;}setInvalid('');onChange(file);};
  return <div className="grid min-w-0 gap-2" data-draft-control="" data-draft-value={value ? JSON.stringify([value.name, value.size, value.type, value.lastModified]) : ""}>
    <input ref={input} type="file" hidden tabIndex={-1} aria-hidden="true" accept={accept} disabled={props.disabled} onChange={event=>{choose(event.target.files?.[0]);event.target.value='';}}/>
    <button ref={chooser} type="button" {...props} className={cn('flex min-h-24 w-full items-center justify-center gap-2 rounded-md border border-dashed border-input bg-background p-4 text-sm hover:border-ring/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive',dragging&&'bg-accent',className)} aria-invalid={!!message||props['aria-invalid']} aria-describedby={[props['aria-describedby'],message?`${id}-error`:undefined,value?`${id}-file`:undefined].filter(Boolean).join(' ')||undefined} onClick={()=>input.current?.click()} onDragOver={event=>{event.preventDefault();if(!props.disabled)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);if(!props.disabled)choose(event.dataTransfer.files[0]);}}><Upload aria-hidden="true" className="size-4 shrink-0"/><span>{t('controls.chooseFile')}</span></button>
    {value&&<div id={`${id}-file`} className="flex min-w-0 items-center justify-between gap-3 text-sm"><div className="min-w-0"><p className="truncate" title={value.name}>{value.name}</p><p className="text-xs text-muted-foreground">{new Intl.NumberFormat(formattingLocale(i18n.language),{style:'unit',unit:'byte',unitDisplay:'short'}).format(value.size)}</p></div><Button type="button" size="icon" variant="ghost" disabled={props.disabled} aria-label={t('controls.removeFile')} onClick={()=>{setInvalid('');onChange(null);chooser.current?.focus();}}><X aria-hidden="true"/></Button></div>}
    {message&&<p id={`${id}-error`} role="alert" className="text-sm text-destructive">{message}</p>}
  </div>;
}
