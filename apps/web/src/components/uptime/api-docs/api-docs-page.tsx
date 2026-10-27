import { DocumentContents } from "@/components/ui/document-contents";
/**
 * Public REST API documentation page.
 *
 * Session dashboard reference. Code examples stay literal; prose is translated.
 *
 * @module components/uptime/api-docs/api-docs-page
 */

import { Link } from "@tanstack/react-router";
import { Download, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import {
	ENDPOINT_GROUPS,
	getApiBaseUrl,
	MANIFEST_SAMPLE,
	MONITOR_OBJECT_SAMPLE,
	RATE_LIMITED_SAMPLE,
	STATUS_PAGE_SAMPLE,
} from "./api-endpoints";
import { CodeBlock } from "./code-block";
import { ApiDocsTable } from "./api-docs-table";
import { EndpointSection } from "./endpoint-section";

/** Anchor section ids, in page order. */
const TOC_IDS = [
	"intro",
	"auth",
	"access",
	"rate-limit",
	"errors",
	"pagination",
	"endpoints",
	"monitor-object",
	"monitor-types",
	"channels",
	"status-pages",
	"openapi",
] as const;

/** Per-client request budget of the public status-page projections (`apps/server/src/api/status-route.ts`). */
const PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE = 240;

/** Per-type notes under "Monitor types", in manifest order. */
const MONITOR_TYPE_KEYS = ["http", "dns", "tcp", "heartbeat", "server"] as const;

function SectionHeading({ id, children }: { id: string; children: string }) {
	return (
		<h2 id={id} className="scroll-mt-[calc(var(--header-height)+1rem)] text-xl font-semibold">
			{children}
		</h2>
	);
}

export function ApiDocsPage() {

	const { t } = useTranslation("apiDocs");
	const apiBase = getApiBaseUrl();

	const header = (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap items-center gap-2">
				<h1 className="app-title">
					{t("title", "API documentation")}
				</h1>
			</div>
			<p className="text-sm text-muted-foreground">
				{t(
					"subtitle",
					"Manage your uptime monitors programmatically with the Pulsy REST API.",
				)}
			</p>
		</div>
	);


	return (
		<div className="flex min-w-0 flex-col gap-8">
			{header}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[208px_minmax(0,1fr)]">
      <DocumentContents title={t("toc.title")} items={TOC_IDS.map(id => ({ id, title: t(`toc.items.${id}`, id) }))} />

			<div className="min-w-0 space-y-8">
      {/* Introduction */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="intro">
					{t("sections.intro.title", "Introduction")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.intro.body", "")}
				</p>
				<CodeBlock language="text" code={apiBase} label={t("sections.intro.baseUrlLabel", "Base URL")} />
			</section>

			{/* Authentication */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="auth">
					{t("sections.auth.title", "Authentication")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.auth.body", "")}
				</p>
				<CodeBlock
					code={"Authorization: Bearer pul_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
					label={t("sections.auth.headerLabel", "Authorization header")}
				/>
				<p className="text-sm text-muted-foreground">
					{t("sections.auth.note", "")}
				</p>
				<div>
					<Button asChild size="sm" className="h-[44px]">
						<Link to="/dashboard/api-keys">
							<KeyRound className="h-4 w-4 me-2" />
							{t("sections.auth.createCta", "Create an API key")}
						</Link>
					</Button>
				</div>
			</section>

			{/* Access levels */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="access">
					{t("sections.access.title", "Access levels")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.access.body", "")}
				</p>
				<ApiDocsTable aria-label={t("sections.access.title", "Access levels")}>
						<TableHeader>
							<TableRow>
								<TableHead className="text-start">
									{t("sections.access.tableHeaders.level", "Key scope")}
								</TableHead>
								<TableHead className="text-start">
									{t("sections.access.tableHeaders.read", "Read endpoints")}
								</TableHead>
								<TableHead className="text-start">
									{t("sections.access.tableHeaders.write", "Write endpoints")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>

							<TableRow>
								<TableCell className="font-mono text-xs">read</TableCell>
								<TableCell>{t("ux.allowed")}</TableCell>
								<TableCell className="text-muted-foreground">403</TableCell>
							</TableRow>
							<TableRow>
								<TableCell className="font-mono text-xs">full</TableCell>
								<TableCell>{t("ux.allowed")}</TableCell>
								<TableCell>{t("ux.allowed")}</TableCell>
							</TableRow>
						</TableBody>
					</ApiDocsTable>
				<p className="text-xs text-muted-foreground">
					{t("sections.access.ossNote", "")}
				</p>
			</section>

			{/* Rate limiting */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="rate-limit">
					{t("sections.rateLimit.title", "Rate limiting")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.rateLimit.body", "")}
				</p>
				<ApiDocsTable aria-label={t("sections.rateLimit.title", "Rate limiting")}>
						<TableHeader>
							<TableRow>
								<TableHead className="text-start">
									{t("sections.rateLimit.tableHeaders.header", "Header")}
								</TableHead>
								<TableHead className="text-start">
									{t("sections.rateLimit.tableHeaders.meaning", "Meaning")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(
								["limit", "remaining", "reset", "retryAfter"] as const
							).map((key) => (
								<TableRow key={key}>
									<TableCell className="font-mono text-xs">
										{key === "limit"
											? "X-RateLimit-Limit"
											: key === "remaining"
												? "X-RateLimit-Remaining"
												: key === "reset"
													? "X-RateLimit-Reset"
													: "Retry-After"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{t(`sections.rateLimit.headers.${key}`, "")}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</ApiDocsTable>
			</section>

			{/* Errors */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="errors">
					{t("sections.errors.title", "Errors")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.errors.body", "")}
				</p>
				<CodeBlock
					language="json" code={'{ "error": { "code": "not_found", "message": "Monitor not found" } }'}
				/>
				<ApiDocsTable aria-label={t("sections.errors.title", "Errors")}>
						<TableHeader>
							<TableRow>
								<TableHead className="text-start">
									{t("sections.errors.tableHeaders.status", "HTTP")}
								</TableHead>
								<TableHead className="text-start">
									{t("sections.errors.tableHeaders.code", "Code")}
								</TableHead>
								<TableHead className="text-start">
									{t("sections.errors.tableHeaders.when", "When")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{(
								[
									["401", "unauthorized"],
									["403", "forbidden"],
									["404", "notFound"],
									["409", "conflict"],
									["422", "validation"],
									["429", "rateLimited"],
									["500", "internal"],
								] as const
							).map(([status, key]) => (
								<TableRow key={key}>
									<TableCell className="text-muted-foreground">
										{status}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{key === "notFound"
											? "not_found"
											: key === "validation"
												? "validation_error"
												: key === "rateLimited"
													? "rate_limited"
													: key}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{t(`sections.errors.rows.${key}`, "")}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</ApiDocsTable>
				<CodeBlock code={RATE_LIMITED_SAMPLE} label={t("sections.errors.rateLimitedExample")} />
				<p className="text-sm text-muted-foreground">
					{t("sections.errors.retryNote")}
				</p>
			</section>

			{/* Pagination */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="pagination">
					{t("sections.pagination.title", "Pagination")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.pagination.body", "")}
				</p>
				<CodeBlock
					code={`GET /api/v1/monitors?limit=50
→ { "data": [ … ], "nextCursor": "MjA" }
GET /api/v1/monitors?limit=50&cursor=MjA
→ { "data": [ … ], "nextCursor": null }`}
				/>
			</section>

			{/* Endpoints */}
			<section className="flex min-w-0 flex-col gap-4">
				<SectionHeading id="endpoints">
					{t("sections.endpoints.title", "Endpoints")}
				</SectionHeading>
				{ENDPOINT_GROUPS.map((group) => (
					<div key={group.titleKey} className="flex min-w-0 flex-col gap-3">
						<h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
							{t(`sections.endpoints.${group.titleKey}`, group.titleKey)}
						</h3>
						{group.endpoints.map((endpoint) => (
							<EndpointSection
								key={endpoint.id}
								endpoint={endpoint}
								apiBase={apiBase}
							/>
						))}
					</div>
				))}
			</section>

			{/* Monitor object */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="monitor-object">
					{t("sections.monitorObject.title", "The monitor object")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.monitorObject.body", "")}
				</p>
				<CodeBlock code={MONITOR_OBJECT_SAMPLE} language="json" />
			</section>

			{/* Monitor types */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="monitor-types">
					{t("sections.monitorTypes.title")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.monitorTypes.body")}
				</p>
				<ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
					{MONITOR_TYPE_KEYS.map(key => (
						<li key={key}>
							<span className="font-mono text-xs text-foreground">{key}</span>{" — "}
							{t(`sections.monitorTypes.items.${key}`)}
						</li>
					))}
				</ul>
				<CodeBlock code={MANIFEST_SAMPLE} language="json" label={t("sections.monitorTypes.exampleLabel")} />
			</section>

			{/* Notification channels */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="channels">
					{t("sections.channels.title")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.channels.body")}
				</p>
				<p className="text-sm text-muted-foreground">
					{t("sections.channels.secrets")}
				</p>
			</section>

			{/* Status pages */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="status-pages">
					{t("sections.statusPages.title")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.statusPages.body", { limit: PUBLIC_STATUS_RATE_LIMIT_PER_MINUTE })}
				</p>
				<CodeBlock code={STATUS_PAGE_SAMPLE.replaceAll("{{origin}}", apiBase.replace(/\/api\/v1$/, ""))} label={t("sections.statusPages.exampleLabel")} />
			</section>

			{/* OpenAPI */}
			<section className="flex min-w-0 flex-col gap-3">
				<SectionHeading id="openapi">
					{t("sections.openapi.title", "OpenAPI specification")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.openapi.body", "")}
				</p>
				<Button asChild variant="outline" className="min-h-11 w-fit">
					<a href="/openapi.yaml" download="pulsy-openapi.yaml">
						<Download aria-hidden className="me-2 size-4" />
						{t("sections.openapi.download", "Download openapi.yaml")}
					</a>
				</Button>
			</section>
      </div></div>
		</div>
	);
}
