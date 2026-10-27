import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { Combobox } from './combobox';
import { LanguageCombobox } from './language-combobox';
import { TimezoneCombobox } from './timezone-combobox';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key,i18n:{language:'en'}})}));
describe('searchable controls',()=>{
  it('filters, selects with keys, exposes active descendant, and returns focus',async()=>{
    function Demo(){const [value,setValue]=useState('one');return <Combobox aria-label="Monitor" value={value} onValueChange={setValue} options={[{value:'one',label:'First monitor'},{value:'two',label:'Second monitor'}]}/>;}
    render(<Demo/>);const trigger=screen.getByRole('combobox');
    expect(trigger).toHaveClass('ps-3.5','pe-10');await userEvent.click(trigger);
    const input=screen.getByRole('combobox',{name:'controls.search'});await userEvent.type(input,'Second');
    await waitFor(()=>expect(screen.getAllByRole('option')).toHaveLength(1));expect(input).toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');await waitFor(()=>expect(trigger).toHaveFocus());expect(trigger).toHaveTextContent('Second monitor');
  });
  it('accepts typing inside a dialog and returns to its trigger on Escape',async()=>{
    render(<Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>Preferences</DialogTitle><LanguageCombobox aria-label="Language" value="en" onValueChange={()=>{}}/></DialogContent></Dialog>);
    const trigger=screen.getByRole('combobox',{name:'Language'});await userEvent.click(trigger);
    const input=screen.getByRole('combobox',{name:'controls.search'});expect(input).toHaveFocus();
    await userEvent.type(input,'Deutsch');expect(screen.getByRole('option',{name:'Deutsch'})).toBeVisible();
    await userEvent.keyboard('{Escape}');await waitFor(()=>expect(trigger).toHaveFocus());expect(screen.getByRole('dialog',{name:'Preferences'})).toBeVisible();
  });
  it('opens with ArrowDown and supports Home/End across enabled options',async()=>{
    const change=vi.fn();render(<Combobox aria-label="Options" value="a" onValueChange={change} options={[{value:'a',label:'Alpha'},{value:'b',label:'Beta',disabled:true},{value:'c',label:'Gamma'}]}/>);
    screen.getByRole('combobox').focus();await userEvent.keyboard('{ArrowDown}');
    await screen.findByRole('option',{name:'Gamma'});await userEvent.keyboard('{End}{Enter}');expect(change).toHaveBeenLastCalledWith('c');
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'Options'})).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');await screen.findByRole('option',{name:'Gamma'});
    await userEvent.keyboard('{End}{Home}{Enter}');expect(change).toHaveBeenLastCalledWith('a');
  });
  it('renders an empty result and restores focus on Escape',async()=>{
    render(<Combobox aria-label="Options" value="" onValueChange={()=>{}} options={[{value:'a',label:'Alpha'}]}/>);
    const trigger=screen.getByRole('combobox');await userEvent.click(trigger);await userEvent.type(screen.getByRole('combobox',{name:'controls.search'}),'missing');expect(screen.getByText('controls.noResults')).toBeVisible();await userEvent.keyboard('{Escape}');await waitFor(()=>expect(trigger).toHaveFocus());
  });
  it('presents native language names and supports a linked label',async()=>{
    render(<><label htmlFor="language">Language</label><LanguageCombobox id="language" value="en" onValueChange={()=>{}}/></>);await userEvent.click(screen.getByRole('combobox',{name:'Language'}));
    for(const name of ['English','العربية','Français','Deutsch','Español']) expect(screen.getByRole('option',{name})).toBeVisible();
  });
  it('keeps an invalid persisted timezone explicit until it is corrected', async () => {
    render(<TimezoneCombobox aria-label="Timezone" value="Mars/Base" onValueChange={()=>{}} />);
    expect(screen.getByRole('combobox',{name:'Timezone'})).toHaveTextContent('Mars/Base');
    await userEvent.click(screen.getByRole('combobox',{name:'Timezone'}));
    expect(screen.getByRole('option',{name:'Mars/Base'})).toHaveAttribute('aria-disabled','true');
    expect(screen.getAllByRole('option',{name:'UTC (GMT+0)'})).toHaveLength(1);
  });
  it('searches IANA names with offsets and keeps UTC available',async()=>{
    render(<TimezoneCombobox aria-label="Timezone" value="UTC" onValueChange={()=>{}}/>);await userEvent.click(screen.getByRole('combobox',{name:'Timezone'}));await userEvent.type(screen.getByRole('combobox',{name:'controls.search'}),'Africa/Tunis');expect(screen.getByRole('option',{name:/Africa\/Tunis \(GMT\+1\)/})).toBeVisible();
  });
});
