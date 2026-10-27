import { formattingLocale } from "@/lib/formatting-locale";
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './date-picker';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './dialog';
import { FileDropzone } from './file-dropzone';
const language=vi.hoisted(()=>({value:'en'}));
afterEach(()=>{language.value='en';});
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string,options?:Record<string,string>)=>options?.types?`${key} ${options.types}`:key,i18n:{language:language.value}})}));
describe('DatePicker',()=>{
  it('focuses today when an empty picker opens inside a dialog', async () => {
    render(<Dialog open><DialogContent><DialogTitle>New key</DialogTitle><DialogDescription>Choose expiry</DialogDescription><DatePicker aria-label="Expiry" onValueChange={()=>{}} /></DialogContent></Dialog>);
    await userEvent.click(screen.getByRole('button',{name:'Expiry'}));
    expect(screen.getByRole('grid').querySelector('[data-today] button')).toHaveFocus();
  });
  it('uses localized day-only dates, bounds, keyboard navigation, clearing and focus return',async()=>{
    function Demo(){const [value,setValue]=useState<string|undefined>('2026-10-14');return <><label htmlFor="expiry">Expiry</label><DatePicker id="expiry" value={value} onValueChange={setValue} min="2026-10-10" max="2026-10-20"/></>;}
    render(<Demo/>);const trigger=screen.getByRole('button',{name:'Expiry'});expect(trigger).toHaveClass('ps-3.5','pe-10');await userEvent.click(trigger);
    expect(screen.getByRole('grid')).toBeVisible();const selected=screen.getByRole('gridcell',{selected:true}).querySelector('button')!;expect(selected).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{Enter}');await waitFor(()=>expect(trigger).toHaveTextContent('Oct 15, 2026'));
    await userEvent.click(trigger);await userEvent.click(screen.getByRole('button',{name:'controls.clearDate'}));await waitFor(()=>expect(trigger).toHaveFocus());expect(trigger).toHaveTextContent('controls.chooseDate');
  });
  it.each([
    ['en', '{Home}', '2026-10-11'],
    ['en', '{End}', '2026-10-17'],
    ['ar', '{Home}', '2026-10-10'],
    ['ar', '{End}', '2026-10-16'],
    ['en', '{ArrowRight}', '2026-10-15'],
    ['en', '{ArrowLeft}', '2026-10-13'],
    ['ar', '{ArrowRight}', '2026-10-13'],
    ['ar', '{ArrowLeft}', '2026-10-15'],
  ])('uses localized week boundaries and arrow direction for %s %s', async (locale, key, expected) => {
    language.value = locale;
    const change = vi.fn();
    render(<DatePicker aria-label="Date" value="2026-10-14" onValueChange={change} min="2026-10-10" max="2026-10-20" />);
    const trigger = screen.getByRole('button', { name: 'Date' });
    await userEvent.click(trigger);
    await userEvent.keyboard(key);
    const expectedName = new Intl.DateTimeFormat(formattingLocale(locale), { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(expected));
    expect(screen.getByRole('button', { name: expectedName })).toHaveFocus();
    expect(change).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    expect(change).toHaveBeenLastCalledWith(expected);
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it.each(['en','ar','fr','de','es'])('localizes and constrains dates in %s',async(locale)=>{
    language.value=locale;
    render(<DatePicker aria-label="Date" value="2026-10-14" onValueChange={()=>{}} min="2026-10-14" max="2026-10-14"/>);
    const trigger=screen.getByRole('button',{name:'Date'});
    expect(trigger).toHaveTextContent(new Intl.DateTimeFormat(formattingLocale(locale),{dateStyle:'medium',timeZone:'UTC'}).format(new Date('2026-10-14')));
    await userEvent.click(trigger);expect(screen.getByRole('dialog')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');
    const days=screen.getByRole('grid').querySelectorAll('button');expect([...days].filter(button=>!button.disabled)).toHaveLength(1);
    expect(screen.getByRole('button',{name:'controls.previousMonth'})).toHaveAttribute('aria-disabled','true');expect(screen.getByRole('button',{name:'controls.nextMonth'})).toHaveAttribute('aria-disabled','true');
    const month=screen.getByRole('grid').getAttribute('aria-label');await userEvent.click(screen.getByRole('button',{name:'controls.nextMonth'}));expect(screen.getByRole('grid')).toHaveAttribute('aria-label',month);
    await userEvent.keyboard('{Escape}');await waitFor(()=>expect(trigger).toHaveFocus());
  });
  it('links invalid state without using a native date input',()=>{render(<DatePicker aria-label="Expiry" aria-invalid value="2026-10-14" onValueChange={()=>{}}/>);expect(screen.getByRole('button')).toHaveAttribute('aria-invalid','true');expect(document.querySelector('input[type=date]')).toBeNull();});
});
describe('FileDropzone',()=>{
  it('chooses, describes, removes, and supports dropping a JSON file',async()=>{
    function Demo(){const [value,setValue]=useState<File|null>(null);return <FileDropzone aria-label="Import" value={value} onChange={setValue} accept=".json,application/json"/>;}
    render(<Demo/>);const file=new File(['{}'],'monitors.json',{type:'application/json'});const input=document.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input).toHaveAttribute('hidden');await userEvent.upload(input,file);expect(screen.getByText('monitors.json')).toBeVisible();
    await userEvent.click(screen.getByRole('button',{name:'controls.removeFile'}));expect(screen.queryByText('monitors.json')).toBeNull();expect(screen.getByRole('button',{name:'Import'})).toHaveFocus();
    fireEvent.drop(screen.getByRole('button',{name:'Import'}),{dataTransfer:{files:[file]}});expect(screen.getByText('monitors.json')).toBeVisible();
  });
  it('opens the file chooser from the keyboard',async()=>{
    render(<FileDropzone aria-label="Import" value={null} onChange={()=>{}} accept=".json"/>);
    const input=document.querySelector<HTMLInputElement>('input[type=file]')!;const open=vi.spyOn(input,'click').mockImplementation(()=>{});
    screen.getByRole('button',{name:'Import'}).focus();await userEvent.keyboard('{Enter}');expect(open).toHaveBeenCalledOnce();
  });
  it('rejects unsupported types and associates the error with the keyboard button',()=>{
    const change=vi.fn();render(<FileDropzone aria-label="Import" value={null} onChange={change} accept=".json"/>);const button=screen.getByRole('button',{name:'Import'});
    fireEvent.drop(button,{dataTransfer:{files:[new File(['bad'],'image.png',{type:'image/png'})]}});expect(change).not.toHaveBeenCalled();expect(button).toHaveAttribute('aria-invalid','true');expect(button).toHaveAccessibleDescription('controls.fileType .json');
  });
});
