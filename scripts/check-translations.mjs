import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const locales=['en','ar','fr','de','es'];
const directory=process.env.PULSY_LOCALE_DIR??resolve(root,'apps/web/public/locales');
const allowlistPath=process.env.PULSY_UNTRANSLATED_ALLOWLIST??`${directory}/.untranslated-allowlist.json`;
const ledgerPath=process.env.PULSY_I18N_LEDGER??`${directory}/.i18n-pending.json`;
const serverDictionaryPath=process.env.PULSY_SERVER_I18N??resolve(root,'apps/server/src/lib/i18n.ts');
const errors=[],warnings=[];
function flatten(value,prefix='',out={}) {
  for(const [key,child] of Object.entries(value)) {
    const name=prefix?`${prefix}.${key}`:key;
    if(typeof child==='string')out[name]=child;
    else if(child&&typeof child==='object')flatten(child,name,out);
  }
  return out;
}
const resources=Object.fromEntries(locales.map(locale=>[locale,Object.fromEntries(readdirSync(`${directory}/${locale}`).filter(name=>name.endsWith('.json')).map(name=>[name.slice(0,-5),flatten(JSON.parse(readFileSync(`${directory}/${locale}/${name}`,'utf8')))]))]));
// The backend keeps one flat dictionary per language in DICTIONARIES; it is
// checked as the pseudo-namespace "server" (ledger keys use "server:<key>").
function serverDictionaries() {
  const source=ts.createSourceFile(serverDictionaryPath,readFileSync(serverDictionaryPath,'utf8'),ts.ScriptTarget.Latest,true);
  const text=node=>ts.isStringLiteralLike(node)?node.text:ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken?(text(node.left)??'')+(text(node.right)??''):ts.isParenthesizedExpression(node)?text(node.expression):undefined;
  let found;
  (function visit(node) {
    if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='DICTIONARIES')found=node.initializer;
    else ts.forEachChild(node,visit);
  })(source);
  while(found&&(ts.isAsExpression(found)||ts.isSatisfiesExpression(found)||ts.isParenthesizedExpression(found)))found=found.expression;
  if(!found||!ts.isObjectLiteralExpression(found)) { errors.push(`${relative(root,serverDictionaryPath)}: DICTIONARIES object literal not found`);return {}; }
  const result={};
  for(const language of found.properties)if(ts.isPropertyAssignment(language)&&ts.isObjectLiteralExpression(language.initializer)) {
    const entries=result[language.name.getText(source).replace(/['"]/g,'')]={};
    for(const entry of language.initializer.properties)if(ts.isPropertyAssignment(entry)) {
      const key=ts.isStringLiteralLike(entry.name)?entry.name.text:entry.name.getText(source),value=text(entry.initializer);
      if(value===undefined)errors.push(`server/${key}: value must be a string literal`);
      else entries[key]=value;
    }
  }
  return result;
}
const server=serverDictionaries();
for(const locale of locales)resources[locale].server=server[locale]??{};
const variables=value=>[...value.matchAll(/{{\s*-?\s*([^},\s]+)(?:,[^}]*)?\s*}}/g)].map(match=>match[1]).sort().join(',');
for(const [namespace,english] of Object.entries(resources.en))for(const [key,value] of Object.entries(english))for(const locale of locales) {
  const translation=resources[locale][namespace]?.[key];
  if(!translation?.trim())errors.push(`${locale}/${namespace}: missing ${key}`);
  else if(variables(value)!==variables(translation))errors.push(`${locale}/${namespace}:${key}: interpolation ${variables(translation)} != ${variables(value)}`);
}
// A locale can require forms that English never uses (Arabic has six;
// French and Spanish also have "many"). Discover families in every locale,
// then validate both the locale's own categories and all supplied variants.
const pluralSuffix=/^(.*)_(zero|one|two|few|many|other)$/;
const pluralFamilies=new Map();
for(const namespaces of Object.values(resources))for(const [namespace,entries] of Object.entries(namespaces))for(const key of Object.keys(entries)) {
  const match=key.match(pluralSuffix);
  if(!match)continue;
  if(!pluralFamilies.has(namespace))pluralFamilies.set(namespace,new Set());
  pluralFamilies.get(namespace).add(match[1]);
}
let pluralFamilyCount=0;
for(const [namespace,bases] of pluralFamilies)for(const base of bases) {
  pluralFamilyCount++;
  const english=resources.en[namespace]??{};
  const canonical=english[`${base}_other`]??english[`${base}_one`]??Object.entries(english).find(([key])=>key.match(pluralSuffix)?.[1]===base)?.[1];
  for(const locale of locales) {
    const entries=resources[locale][namespace]??{};
    for(const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
      const key=`${base}_${category}`;
      if(!entries[key]?.trim())errors.push(`${locale}/${namespace}: missing plural category ${key}`);
    }
    for(const [key,value] of Object.entries(entries))if(key.match(pluralSuffix)?.[1]===base&&canonical!==undefined&&variables(value)!==variables(canonical)) {
      errors.push(`${locale}/${namespace}:${key}: plural interpolation ${variables(value)} != ${variables(canonical)}`);
    }
  }
}
// Untranslated text, hard-coded digits and the pending ledger. A value equal
// to English fails unless only brand/technical tokens, variables and at most
// three letters remain, the locale allowlists it as correct as written, or its
// key is in the pending ledger (reported as a warning until explicitly reviewed).
const allowlist=JSON.parse(readFileSync(allowlistPath,'utf8'));
const ledger=JSON.parse(readFileSync(ledgerPath,'utf8'));
for(const section of ['identical','digits'])for(const locale of Object.keys(allowlist[section]??{}))if(!locales.includes(locale)||locale==='en')errors.push(`allowlist: unknown ${section} locale ${locale}`);
const tokenPattern=[...(allowlist.tokens??[])].sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|');
const tokenExpression=tokenPattern?new RegExp(`(?<![\\p{L}\\p{N}_])(?:${tokenPattern})(?![\\p{L}\\p{N}_])`,'gu'):undefined;
function escapeRegExp(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
const stripMarkup=value=>value.replace(/{{[^}]*}}/g,' ').replace(/<[^>]*>/g,' ');
const residue=value=>{const text=stripMarkup(value);return (tokenExpression?text.replace(tokenExpression,' '):text).match(/\p{L}/gu)?.length??0;};
// English source for a locale key; locale-only plural categories (Arabic
// zero/two/few/many, French/Spanish many) compare with the English _other form.
const englishSource=(namespace,key)=>{
  const english=resources.en[namespace]??{};
  if(key in english)return english[key];
  const plural=key.match(pluralSuffix);
  return plural?english[`${plural[1]}_other`]??english[`${plural[1]}_one`]:undefined;
};
const ledgerEntries=new Map();
for(const [entry,meta] of Object.entries(ledger)) {
  const colon=entry.indexOf(':'),namespace=entry.slice(0,colon),key=entry.slice(colon+1);
  if(colon<1||!key)errors.push(`ledger: malformed key ${entry} (expected <namespace>:<key>)`);
  else if(!locales.some(locale=>key in (resources[locale][namespace]??{})))errors.push(`ledger: ${entry} no longer exists; remove it from ${relative(root,ledgerPath)}`);
  if(!/^\d{2}$/.test(meta?.area??'')||typeof meta?.addedBy!=='string'||!meta.addedBy.trim())errors.push(`ledger: ${entry} needs {"area":"NN","addedBy":"<prompt file>"}`);
  ledgerEntries.set(entry,{area:meta?.area,locales:[]});
}
const usedIdentical=new Set();
for(const locale of locales.filter(locale=>locale!=='en'))for(const [namespace,entries] of Object.entries(resources[locale]))for(const [key,value] of Object.entries(entries)) {
  const source=englishSource(namespace,key),name=`${namespace}:${key}`;
  if(source===undefined||value!==source||residue(value)<=3)continue;
  if(allowlist.identical?.[locale]?.includes(value)) { usedIdentical.add(`${locale}\u0000${value}`);continue; }
  const pending=ledgerEntries.get(name);
  if(pending)pending.locales.push(locale);
  else errors.push(`${locale}/${namespace}:${key}: untranslated (identical to English): ${JSON.stringify(value.length>80?`${value.slice(0,77)}...`:value)}`);
}
for(const [locale,values] of Object.entries(allowlist.identical??{}))for(const value of values)if(!usedIdentical.has(`${locale}\u0000${value}`))warnings.push(`allowlist: ${locale} identical value ${JSON.stringify(value)} is no longer used; remove it`);
// Numbers come from interpolation variables. Arabic-Indic digits are never
// allowed (Latin digits are the project rule); a translation must not
// introduce numbers its English source does not contain, and a plural form
// must not spell a number instead of using its count variable.
const numbers=value=>{
  const counts=new Map();
  for(const run of stripMarkup(value).replace(/(?<=\d)[.,\u00a0\u202f\u2009' ](?=\d{3}(?!\d))/g,'').match(/\d+/g)??[])counts.set(run,(counts.get(run)??0)+1);
  return counts;
};
for(const locale of locales)for(const [namespace,entries] of Object.entries(resources[locale]))for(const [key,value] of Object.entries(entries)) {
  const name=`${namespace}:${key}`;
  if(/[\u0660-\u0669\u06f0-\u06f9]/.test(value))errors.push(`${locale}/${name}: Arabic-Indic digits; use Latin digits or a variable`);
  if(key.match(pluralSuffix)&&!/{{/.test(value)&&/\d/.test(stripMarkup(value)))errors.push(`${locale}/${name}: plural form hard-codes a number; use its count variable`);
  if(locale==='en'||allowlist.digits?.[locale]?.includes(name))continue;
  const source=englishSource(namespace,key);
  if(source===undefined)continue;
  const expected=numbers(source);
  const extra=[...numbers(value)].filter(([run,count])=>count>(expected.get(run)??0)).map(([run])=>run);
  if(extra.length)errors.push(`${locale}/${name}: hard-coded digits ${extra.join(', ')} not in English source; use a variable`);
}
for(const [locale,names] of Object.entries(allowlist.digits??{}))for(const name of names) {
  const colon=name.indexOf(':');
  if(resources[locale]?.[name.slice(0,colon)]?.[name.slice(colon+1)]===undefined)errors.push(`allowlist: ${locale} digits entry ${name} does not exist`);
}
const pendingByArea=new Map(),settled=[];
for(const [name,entry] of ledgerEntries) {
  if(!entry.locales.length) { settled.push(name);continue; }
  pendingByArea.set(entry.area,(pendingByArea.get(entry.area)??0)+1);
  if(process.env.PULSY_I18N_VERBOSE)warnings.push(`pending (area ${entry.area}): ${name} [${entry.locales.join(',')}]`);
}
if(settled.length)warnings.push(`ledger: ${settled.length} keys no longer equal English in any locale; remove them once reviewed${process.env.PULSY_I18N_VERBOSE?`: ${settled.join(', ')}`:''}`);
function* files(dir) {
  for(const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=`${dir}/${entry.name}`;
    if(entry.isDirectory())yield*files(path);
    else if(/\.(ts|tsx)$/.test(path)&&!/(\.test\.|routeTree\.gen|\.d\.ts$)/.test(path))yield path;
  }
}
const strings=node=>{
  if(ts.isStringLiteralLike(node))return [node.text];
  if(ts.isConditionalExpression(node))return [...strings(node.whenTrue),...strings(node.whenFalse)];
  if(ts.isArrayLiteralExpression(node))return node.elements.flatMap(strings);
  return [];
};
const escape=escapeRegExp;
let references=0,families=0;
for(const file of files(`${root}/apps/web/src`)) {
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const namespaces=new Set(['common']); let hasNamespace=false;
  function discover(node) {
    if(ts.isCallExpression(node)&&node.expression.getText(source)==='useTranslation'){ hasNamespace=true; for(const name of node.arguments[0]?strings(node.arguments[0]):[])namespaces.add(name); }
    ts.forEachChild(node,discover);
  }
  discover(source);
  if(!hasNamespace)for(const namespace of Object.keys(resources.en))if(namespace!=='server')namespaces.add(namespace);
  function check(pattern,dynamic,node) {
    const objects=node.arguments.slice(1).some(arg=>/returnObjects\s*:\s*true/.test(arg.getText(source)));
    const colon=/^[A-Za-z]+:/.test(pattern)?pattern.indexOf(':'):-1;
    const candidates=colon<0?[...namespaces]:[pattern.slice(0,colon)];
    const key=colon<0?pattern:pattern.slice(colon+1);
    const expression=new RegExp(`^${key}(?:_(?:zero|one|two|few|many|other))?${objects?'(?:\\..+)?':''}$`);
    const matches=candidates.flatMap(ns=>Object.keys(resources.en[ns]??{}).filter(k=>expression.test(k)).map(k=>[ns,k]));
    if(!matches.length)errors.push(`${relative(root,file)}:${source.getLineAndCharacterOfPosition(node.pos).line+1}: missing ${pattern}`);
    for(const [ns,k] of matches)for(const locale of locales)if(!resources[locale][ns]?.[k]?.trim())errors.push(`${locale}/${ns}: referenced missing ${k}`);
    dynamic?families++:references++;
  }
  function visit(node) {
    if(ts.isCallExpression(node)) {
      const callee=node.expression.getText(source);
      const argument=/^(?:t|common|commonT|uptimeT|i18n\.t)$/.test(callee)?node.arguments[0]:callee==='formatCount'?node.arguments[1]:undefined;
      if(argument) {
      for(const value of strings(argument))check(escape(value),false,node);
      if(ts.isTemplateExpression(argument)) {
        let pattern=escape(argument.head.text);
        for(const span of argument.templateSpans)pattern+=(strings(span.expression).length?`(?:${strings(span.expression).map(escape).join('|')})`:'.+')+escape(span.literal.text);
        check(pattern,true,node);
      }
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
}
const pendingTotal=[...pendingByArea.values()].reduce((sum,count)=>sum+count,0);
if(pendingTotal)warnings.push(`pending: ${pendingTotal} ledger keys keep interim English values (${[...pendingByArea].sort().map(([area,count])=>`area ${area}: ${count}`).join(', ')}); set PULSY_I18N_VERBOSE=1 to list them`);
if(warnings.length)console.warn([...new Set(warnings)].map(line=>`warning: ${line}`).join('\n'));
if(errors.length) { console.error([...new Set(errors)].join('\n'));process.exitCode=1; }
else console.log(`Translation integrity passed: ${locales.length} locales + server dictionary, ${references} literal references, ${families} dynamic families, ${pluralFamilyCount} complete plural families, interpolation parity (no fallback), no untranslated values outside the allowlist and ${ledgerEntries.size} pending ledger keys, no hard-coded digits.`);
