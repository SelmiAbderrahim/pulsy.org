import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from './select';
vi.mock('react-i18next', () => ({useTranslation:()=>({i18n:{language:'en'}})}));
afterEach(()=>vi.restoreAllMocks());
function Example({size='default', disabled=false, invalid=false}:{size?:'sm'|'default';disabled?:boolean;invalid?:boolean}) {
  return <><label htmlFor="sample">Interval</label><Select defaultValue="one"><SelectTrigger id="sample" size={size} disabled={disabled} aria-invalid={invalid}><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectLabel>Intervals</SelectLabel><SelectItem value="one" description="A short check">One minute</SelectItem><SelectSeparator/><SelectItem value="five">Five minutes</SelectItem><SelectItem value="ten">Ten minutes</SelectItem></SelectGroup></SelectContent></Select></>;
}
describe('shared Select contract',()=>{
  it('has labeled form geometry, invalid state and a fixed end chevron',()=>{
    render(<Example invalid/>);const trigger=screen.getByRole('combobox',{name:'Interval'});
    expect(trigger).toHaveClass('ps-3.5','pe-10','h-[var(--control-height)]','aria-[invalid=true]:border-destructive');
    expect(trigger.querySelector('[data-control-icon]')).toHaveClass('absolute','end-3','size-5');
    expect(trigger.querySelector('svg')).toHaveClass('size-4','text-muted-foreground');
    expect(trigger).toHaveAttribute('aria-invalid','true');
  });
  it('offers 36px toolbar size and a disabled trigger',()=>{
    render(<Example size="sm" disabled/>);expect(screen.getByRole('combobox')).toHaveClass('h-9','min-h-9');expect(screen.getByRole('combobox')).toBeDisabled();
  });
  it('portals capped content, preserves selected label without description, and restores focus',async()=>{
    const {container}=render(<Example/>);const trigger=screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('One minute');expect(trigger).not.toHaveTextContent('A short check');
    await userEvent.click(trigger);const list=screen.getByRole('listbox');
    expect(container.contains(list)).toBe(false);expect(list).toHaveClass('max-h-[320px]','min-w-[var(--radix-select-trigger-width)]','shadow-xs','z-50');
    const option=screen.getByRole('option',{name:'One minute'});expect(option).toHaveClass('min-h-[40px]','ps-8');expect(screen.getByText('A short check')).toBeVisible();expect(option).toHaveAccessibleDescription('A short check');
    await userEvent.keyboard('{End}{Enter}');await waitFor(()=>expect(trigger).toHaveFocus());expect(trigger).toHaveTextContent('Ten minutes');
    await userEvent.keyboard('{ArrowDown}{Home}{Enter}');await waitFor(()=>expect(trigger).toHaveTextContent('One minute'));
    await userEvent.click(trigger);await userEvent.keyboard('{Escape}');await waitFor(()=>expect(trigger).toHaveFocus());
  });
  it('supports arrow navigation and type-ahead',async()=>{
    render(<Example/>);const trigger=screen.getByRole('combobox');
    await userEvent.click(trigger);await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(()=>expect(trigger).toHaveTextContent('Five minutes'));
    await userEvent.click(trigger);await userEvent.keyboard('t');
    await waitFor(()=>expect(screen.getByRole('option',{name:'Ten minutes'})).toHaveFocus());
    await userEvent.keyboard('{Enter}');await waitFor(()=>expect(trigger).toHaveTextContent('Ten minutes'));
  });
  it('warns during development about unnamed triggers',()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    render(<Select><SelectTrigger><SelectValue/></SelectTrigger></Select>);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SelectTrigger requires'));
  });
});
