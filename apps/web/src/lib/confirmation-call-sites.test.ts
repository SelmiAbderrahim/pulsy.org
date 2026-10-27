import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isRepeatedConfirmationText } from "./confirmation-text";

const LOCALES = ["en", "ar", "fr", "de", "es"] as const;
function sources(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
	});
}

const dictionaries = new Map<string, Record<string, unknown>>();
function dictionary(locale: string, namespace: string) {
	const id = `${locale}/${namespace}`;
	if (!dictionaries.has(id)) dictionaries.set(id, JSON.parse(readFileSync(`public/locales/${locale}/${namespace}.json`, "utf8")));
	return dictionaries.get(id)!;
}
function lookup(locale: string, ref: string, defaultNamespace: string): string[] {
	const [namespace, path] = (ref.includes(":") ? ref.split(":") : [defaultNamespace, ref]) as [string, string];
	const segments = path.split(".");
	const last = segments.pop()!;
	const parent = segments.reduce<unknown>((entry, segment) => (entry as Record<string, unknown> | undefined)?.[segment], dictionary(locale, namespace)) as Record<string, unknown> | undefined;
	return ["", "_zero", "_one", "_two", "_few", "_many", "_other"].map(suffix => parent?.[`${last}${suffix}`]).filter((value): value is string => typeof value === "string");
}

type Site = { file: string; namespace: string; description: string; title: string };
function callSites(): Site[] {
	const sites: Site[] = [];
	for (const file of sources("src")) {
		const text = readFileSync(file, "utf8");
		const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const namespace = /useTranslation\("(\w+)"/.exec(text)?.[1] ?? "common";
		const variables = new Map<string, ts.Expression>();
		function collect(node: ts.Node) {
			if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
			ts.forEachChild(node, collect);
		}
		collect(source);
		function key(expression: ts.Expression | undefined): string {
			if (!expression) return "";
			if (ts.isIdentifier(expression)) return key(variables.get(expression.text));
			if (!ts.isCallExpression(expression)) return "";
			const translator = expression.expression;
			if (!(ts.isIdentifier(translator) && translator.text === "t") && !(ts.isPropertyAccessExpression(translator) && translator.name.text === "t")) return "";
			const argument = expression.arguments[0];
			return argument && ts.isStringLiteralLike(argument) ? argument.text : "";
		}
		function visit(node: ts.Node) {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "requestConfirmation") {
				const options = node.arguments[1];
				const title = options && ts.isObjectLiteralExpression(options) ? options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(source) === "title") : undefined;
				sites.push({ file, namespace, description: key(node.arguments[0]), title: title && ts.isPropertyAssignment(title) ? key(title.initializer) : "" });
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
	}
	return sites;
}

describe("confirmation call sites", () => {
	const sites = callSites();
	it("resolves both translated strings for every confirmation, including the shared discard guard", () => {
		expect(sites.length).toBeGreaterThanOrEqual(18);
		expect(sites.some(site => site.file.endsWith("lib/confirmation.ts"))).toBe(true);
		for (const site of sites) {
			expect(site.title, `${site.file} title`).not.toBe("");
			expect(site.description, `${site.file} description`).not.toBe("");
		}
	});
	it.each(LOCALES)("gives every confirmation a specific title and a distinct consequence in %s", locale => {
		const filled = (value: string) => value.replace(/\{\{[^}]+\}\}/g, "X");
		const genericTitles = lookup(locale, "common:actions.confirm", "common");
		for (const site of sites) {
			const titles = lookup(locale, site.title, site.namespace);
			const descriptions = lookup(locale, site.description, site.namespace);
			expect(titles.length, `${site.file}: ${site.title} missing in ${locale}`).toBeGreaterThan(0);
			expect(descriptions.length, `${site.file}: ${site.description} missing in ${locale}`).toBeGreaterThan(0);
			for (const title of titles) {
				for (const generic of genericTitles) expect(isRepeatedConfirmationText(filled(title), generic), `${site.file}: generic title in ${locale}`).toBe(false);
				for (const description of descriptions) expect(isRepeatedConfirmationText(filled(title), filled(description)), `${site.file}: repeated description in ${locale}`).toBe(false);
			}
		}
	});
});
