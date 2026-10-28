import { Combobox, type ComboboxProps } from './combobox';
const languages=[{value:'en',label:'English'},{value:'ar',label:'العربية'},{value:'fr',label:'Français'},{value:'de',label:'Deutsch'},{value:'es',label:'Español'}];
export function LanguageCombobox(props:Omit<ComboboxProps,'options'>){return <Combobox {...props} options={languages}/>;}
