import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
test('translation gate rejects removed Status keys and interpolation mismatches',()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'pulsy-locales-'));
  const run=()=>spawnSync(process.execPath,[resolve(root,'scripts/check-translations.mjs')],{encoding:'utf8',env:{...process.env,PULSY_LOCALE_DIR:directory}});
  const change=(locale,edit)=>{
    const path=`${directory}/${locale}/uptimeMonitor.json`,data=JSON.parse(readFileSync(path,'utf8'));
    edit(data);writeFileSync(path,JSON.stringify(data));
  };
  try {
    cpSync(resolve(root,'apps/web/public/locales'),directory,{recursive:true});
    let result=run();assert.equal(result.status,0,result.stderr);
    change('fr',data=>{delete data.monitors.columns.status;});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/fr\/uptimeMonitor.*monitors.columns.status/);
    cpSync(resolve(root,'apps/web/public/locales'),directory,{recursive:true});
    for(const locale of ['en','ar','fr','de','es']) {
      const file=resolve(directory,locale,'apiDocs.json'),data=JSON.parse(readFileSync(file,'utf8'));
      delete data.title;delete data.subtitle;writeFileSync(file,JSON.stringify(data));
    }
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/api-docs-page.*missing (title|subtitle)/);
    cpSync(resolve(root,'apps/web/public/locales'),directory,{recursive:true});
    change('de',data=>{data.delete.description='{{wrongVariable}}';});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/interpolation/);
    cpSync(resolve(root,'apps/web/public/locales'),directory,{recursive:true});
    for(const locale of ['en','ar','fr','de','es'])change(locale,data=>{delete data.monitors.columns.status;});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/response-time-chart.*missing monitors/);
    cpSync(resolve(root,'apps/web/public/locales'),directory,{recursive:true});
    for(const locale of ['en','ar','fr','de','es'])change(locale,data=>{
      for(const key of Object.keys(data.templates))if(key==='rulesCount'||key.startsWith('rulesCount_'))delete data.templates[key];
    });
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/monitor-reuse-controls.*missing templates.*rulesCount/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('translation gate requires each locale plural category and consistent family variables',()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'pulsy-plurals-'));
  const locales=['en','ar','fr','de','es'];
  const run=()=>spawnSync(process.execPath,[resolve(root,'scripts/check-translations.mjs')],{encoding:'utf8',env:{...process.env,PULSY_LOCALE_DIR:directory}});
  const change=(locale,edit)=>{
    const path=`${directory}/${locale}/uptimeMonitor.json`,data=JSON.parse(readFileSync(path,'utf8'));
    edit(data);writeFileSync(path,JSON.stringify(data));
  };
  const reset=()=>{
    cpSync(resolve(root,'apps/web/public/locales'),directory,{recursive:true});
    for(const locale of locales) change(locale,data=>{
      data.translationGuardFixture=Object.fromEntries(new Intl.PluralRules(locale).resolvedOptions().pluralCategories.map(category=>[`items_${category}`,`{{count}} items for {{name}} (${locale})`]));
    });
  };
  try {
    reset();let result=run();assert.equal(result.status,0,result.stderr);
    // None of these locale-specific forms exist in English, so English-key
    // parity alone cannot detect their removal.
    for(const [locale,category] of [['ar','zero'],['ar','two'],['ar','few'],['ar','many'],['fr','many'],['es','many']]) {
      reset();change(locale,data=>{delete data.translationGuardFixture[`items_${category}`];});
      result=run();assert.equal(result.status,1,`${locale}/${category}: ${result.stderr}`);
      assert.match(result.stderr,new RegExp(`${locale}/uptimeMonitor.*translationGuardFixture\\.items_${category}`));
    }
    reset();change('ar',data=>{data.translationGuardFixture.items_few='{{wrongCount}} items for {{name}}';});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/ar\/uptimeMonitor:translationGuardFixture\.items_few:.*interpolation/);
    // Keep cross-locale key parity, but break parity between one and other.
    reset();for(const locale of locales)change(locale,data=>{data.translationGuardFixture.items_one='{{count}} items';});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/en\/uptimeMonitor:translationGuardFixture\.items_one:.*interpolation/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('translation gate rejects untranslated text and hard-coded digits, and honours the pending ledger',()=>{
  const directory=mkdtempSync(resolve(tmpdir(),'pulsy-untranslated-'));
  const ledgerPath=resolve(directory,'i18n-pending.json');
  const ledger=JSON.parse(readFileSync(resolve(root,'apps/web/public/locales/.i18n-pending.json'),'utf8'));
  const run=()=>spawnSync(process.execPath,[resolve(root,'scripts/check-translations.mjs')],{encoding:'utf8',env:{...process.env,PULSY_LOCALE_DIR:`${directory}/locales`,PULSY_I18N_LEDGER:ledgerPath}});
  const change=(locale,edit)=>{
    const path=`${directory}/locales/${locale}/uptimeMonitor.json`,data=JSON.parse(readFileSync(path,'utf8'));
    edit(data);writeFileSync(path,JSON.stringify(data));
  };
  const reset=(entries=ledger)=>{
    cpSync(resolve(root,'apps/web/public/locales'),`${directory}/locales`,{recursive:true});
    writeFileSync(ledgerPath,JSON.stringify(entries));
  };
  const english=JSON.parse(readFileSync(resolve(root,'apps/web/public/locales/en/uptimeMonitor.json'),'utf8'));
  try {
    reset();let result=run();assert.equal(result.status,0,result.stderr);
    // An English sentence copied into a locale fails; brand tokens alone do not.
    reset();change('es',data=>{data.delete.title=english.delete.title;});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/es\/uptimeMonitor:delete\.title: untranslated/);
    reset();for(const locale of ['en','fr'])change(locale,data=>{data.delete.title='Slack Webhook URL';});
    result=run();assert.equal(result.status,0,result.stderr);
    // The same copy is only a pending warning while the ledger lists the key.
    // Fixture area 99 is never used by real ledger entries.
    reset({...ledger,'uptimeMonitor:delete.title':{area:'99',addedBy:'fixture'}});change('es',data=>{data.delete.title=english.delete.title;});
    result=run();assert.equal(result.status,0,result.stderr);assert.match(result.stderr,/warning: pending:.*area 99: 1/);
    // A ledger key that no longer exists fails.
    reset({...ledger,'uptimeMonitor:translationGuard.removed':{area:'09',addedBy:'fixture'}});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/ledger: uptimeMonitor:translationGuard\.removed no longer exists/);
    // Arabic-Indic digits and numbers absent from English both fail.
    reset();change('ar',data=>{data.share.dialog.expiry30='٣٠ يومًا';});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/ar\/uptimeMonitor:share\.dialog\.expiry30: Arabic-Indic digits/);
    reset();change('de',data=>{data.delete.title=`${data.delete.title} 30`;});
    result=run();assert.equal(result.status,1);assert.match(result.stderr,/de\/uptimeMonitor:delete\.title: hard-coded digits 30/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
