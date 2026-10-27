import MarkdownIt from "markdown-it";
import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

export interface HelpDocument {
  title: string;
  titleId: string;
  html: string;
  headings: Array<{ id: string; title: string; level: number }>;
  /** First paragraph as plain text (≤ 180 chars) for the help index. */
  summary: string;
}

/** Repository Markdown is compiled by the CommonMark parser, never as JSX/HTML. */
export function compileHelp(source: string): HelpDocument {
  const md = new MarkdownIt({ html: false, linkify: false });
  const tokens = md.parse(source, {});
  const headings: HelpDocument["headings"] = [];
  const ids = new Map<string, number>();
  let title = "";
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token || token.type !== "heading_open") continue;
    const text = tokens[index + 1]?.content ?? "";
    const base = text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
    const count = (ids.get(base) ?? 0) + 1;
    ids.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    token.attrSet("id", id);
    if (token.tag === "h1" && !title) title = text;
    headings.push({ id, title: text, level: Number(token.tag.slice(1)) });
  }
  for (const rule of ["fence", "code_block"]) {
    const render = md.renderer.rules[rule];
    if (!render) continue;
    md.renderer.rules[rule] = (items, index, options, env, renderer) => {
      const section = items.slice(0, index).reverse().find(token => token.type === "heading_open")?.attrGet("id") ?? headings[0]?.id ?? "help-title";
      return render(items, index, options, env, renderer).replace("<pre>", `<pre tabindex="0" role="region" aria-labelledby="${md.utils.escapeHtml(String(section))}" dir="ltr">`);
    };
  }
  const tableOpen = md.renderer.rules.table_open;
  md.renderer.rules.table_open = (items, index, options, env, renderer) =>
    `<div class="help-table" tabindex="0" role="region" aria-labelledby="${md.utils.escapeHtml(headings[0]?.id ?? "help-title")}">${tableOpen?.(items, index, options, env, renderer) ?? renderer.renderToken(items, index, options)}`;
  md.renderer.rules.table_close = () => "</table></div>\n";
  const firstParagraph = tokens.findIndex((token, position) => token.type === "paragraph_open" && tokens[position + 1]?.type === "inline");
  const summaryText = (firstParagraph >= 0 ? tokens[firstParagraph + 1]?.content ?? "" : "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  const summary = summaryText.length > 180 ? `${summaryText.slice(0, 177).replace(/\s+\S*$/, "").replace(/[\p{P}\s]+$/gu, "")}…` : summaryText;
  const hasLeadingTitle = tokens[0]?.type === "heading_open" && tokens[0]?.tag === "h1";
  return { title, summary, titleId: headings.find(heading => heading.level === 1)?.id ?? "help-title", headings, html: md.renderer.render(hasLeadingTitle ? tokens.slice(3) : tokens, md.options, {}) };
}

export function helpMarkdown(): Plugin {
  return {
    name: "pulsy-help-markdown",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(".md?help")) return;
      const path = id.slice(0, -5);
      // A build-only import for repository guides; never a user-supplied path.
      if (!/\/docs\/(uptime|api)\//.test(path)) throw new Error("Help import outside documentation");
      this.addWatchFile(path);
      return `export default ${JSON.stringify(compileHelp(await readFile(path, "utf8")))};`;
    },
  };
}
