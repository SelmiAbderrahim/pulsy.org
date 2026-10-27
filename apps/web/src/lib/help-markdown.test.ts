import { describe, expect, it } from "vitest";
import { compileHelp } from "../../help-markdown";

describe("trusted build-time documentation", () => {
  it("renders headings, lists, tables and code with stable unique anchors", () => {
    const result = compileHelp("# Guide\n\n## Étapes\n\n1. Open settings\n2. Save\n\n## Étapes\n\n| Name | Value |\n| --- | --- |\n| zero | 0 |\n\n```json\n{\"ok\":false}\n```\n");
    expect(result.title).toBe("Guide");
    expect(result.headings.map(item => item.id)).toEqual(["guide", "étapes", "étapes-2"]);
    expect(result.html).toContain("<ol>");
    expect(result.html).toContain("<table>");
    expect(result.html).toContain('class="language-json"');
    expect(result.html).toContain('tabindex="0" role="region" aria-labelledby="étapes-2" dir="ltr"');
  });
  it("keeps embedded HTML and executable links inert", () => {
    const result = compileHelp('# Safe\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))\n\n[good](https://example.invalid/docs)');
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain('href="javascript:');
    expect(result.html).toContain('href="https://example.invalid/docs"');
    expect(result.html).toContain("&lt;script&gt;");
  });
});

describe("every shipped guide is scannable", () => {
  const files = ["server-monitoring", "http-checks", "dns-tcp", "heartbeat", "latency-alerts", "reliability", "maintenance", "saved-views", "incidents", "status-communication", "configuration-portability", "prometheus"];
  it.each(["en", "ar", "fr", "de", "es"])("%s: no two sections share a title, and each guide has a plain-text summary", async language => {
    const { readFileSync } = await import("node:fs");
    for (const name of files) {
      const path = language === "en" ? (name === "prometheus" ? `../../docs/api/${name}.md` : `../../docs/uptime/${name}.md`) : `../../docs/uptime/${language}/${name}.md`;
      const result = compileHelp(readFileSync(path, "utf8"));
      const titles = result.headings.filter(heading => heading.level >= 2).map(heading => heading.title);
      expect(new Set(titles).size, `${language}/${name} repeats a heading: ${titles.join(" | ")}`).toBe(titles.length);
      expect(result.summary.length, `${language}/${name} summary`).toBeGreaterThan(20);
      expect(result.summary).not.toMatch(/[*_`\[\]]/);
    }
  });
  it("shortens a long first paragraph at a word boundary", () => {
    const text = `# T\n\n${"word ".repeat(80)}\n`;
    const { summary } = compileHelp(text);
    expect(summary.length).toBeLessThanOrEqual(181);
    expect(summary.endsWith("…")).toBe(true);
  });
});



it.each([".", "...", ",", ";", "؛", "؟", "…"])("removes trailing %s before a shortened excerpt ellipsis", punctuation => {
  const prefix = "word ".repeat(34) + "end";
  expect(compileHelp(`# Guide\n\n${prefix}${punctuation} ${"tail ".repeat(30)}`).summary).toBe(`${prefix}…`);
});
