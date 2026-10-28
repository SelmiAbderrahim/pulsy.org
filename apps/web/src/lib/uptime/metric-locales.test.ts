import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

describe("metric state translations",()=>{
  it.each(["en","ar","fr","de","es"])("includes all metric states and average context in %s",locale=>{
    const dictionary=JSON.parse(readFileSync(`public/locales/${locale}/uptimeMonitor.json`,"utf8"));
    // The rolling window is a plural family ({{count}} days), never a digit literal.
    for(const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) expect(dictionary.metrics[`noChecks_${category}`]).toContain("{{count}}");
    for(const key of ["noData","collecting","loading","error","retry","listError","retryList","windowBasis","averageBasis"]){
      expect(dictionary.metrics[key]).toEqual(expect.any(String));
      expect(dictionary.metrics[key].length).toBeGreaterThan(3);
      expect(dictionary.metrics[key]).not.toBe(`metrics.${key}`);
    }
    expect(dictionary.metrics.averageBasis).toContain("{{count}}");
  });
});
