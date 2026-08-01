/**
 * Public REST API documentation page.
 *
 * Reachable at `/dashboard/api-docs`. The page is hand-built (no markdown
 * renderer) and fully translated; code samples stay literal.
 *
 * @module components/uptime/api-docs/api-docs-page
 */

import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import {
	ENDPOINT_GROUPS,
	getApiBaseUrl,
	MONITOR_OBJECT_SAMPLE,
} from "./api-endpoints";
import { CodeBlock } from "./code-block";
import { EndpointSection } from "./endpoint-section";

/** Anchor section ids, in page order. */
const TOC_IDS = [
	"intro",
	"auth",
	"rate-limit",
	"errors",
	"pagination",
	"endpoints",
	"monitor-object",
	"openapi",
] as const;

function SectionHeading({ id, children }: { id: string; children: string }) {
	return (
		<h2 id={id} className="scroll-mt-20 text-xl font-semibold">
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
				<h1 className="text-2xl font-semibold">
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
		<div className="flex flex-col gap-8">
			{header}

			{/* Table of contents */}
			<nav
				aria-label={t("toc.title", "On this page")}
				className="rounded-lg border bg-muted/40 p-4"
			>
				<p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					{t("toc.title", "On this page")}
				</p>
				<ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
					{TOC_IDS.map((id) => (
						<li key={id}>
							<a
								href={`#${id}`}
								className="text-primary underline-offset-4 hover:underline"
							>
								{t(`toc.items.${id}`, id)}
							</a>
						</li>
					))}
				</ul>
			</nav>

			{/* Introduction */}
			<section className="flex flex-col gap-3">
				<SectionHeading id="intro">
					{t("sections.intro.title", "Introduction")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.intro.body", "")}
				</p>
				<CodeBlock code={apiBase} label={t("sections.intro.baseUrlLabel", "Base URL")} />
			</section>

			{/* Authentication */}
			<section className="flex flex-col gap-3">
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

			{/* Rate limiting */}
			<section className="flex flex-col gap-3">
				<SectionHeading id="rate-limit">
					{t("sections.rateLimit.title", "Rate limiting")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.rateLimit.body", "")}
				</p>
				<div className="overflow-x-auto rounded-lg border">
					<Table>
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
					</Table>
				</div>
			</section>

			{/* Errors */}
			<section className="flex flex-col gap-3">
				<SectionHeading id="errors">
					{t("sections.errors.title", "Errors")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.errors.body", "")}
				</p>
				<CodeBlock
					code={'{ "error": { "code": "not_found", "message": "Monitor not found" } }'}
				/>
				<div className="overflow-x-auto rounded-lg border">
					<Table>
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
					</Table>
				</div>
			</section>

			{/* Pagination */}
			<section className="flex flex-col gap-3">
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
			<section className="flex flex-col gap-4">
				<SectionHeading id="endpoints">
					{t("sections.endpoints.title", "Endpoints")}
				</SectionHeading>
				{ENDPOINT_GROUPS.map((group) => (
					<div key={group.titleKey} className="flex flex-col gap-3">
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
			<section className="flex flex-col gap-3">
				<SectionHeading id="monitor-object">
					{t("sections.monitorObject.title", "The monitor object")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.monitorObject.body", "")}
				</p>
				<CodeBlock code={MONITOR_OBJECT_SAMPLE} />
			</section>

			{/* OpenAPI */}
			<section className="flex flex-col gap-3">
				<SectionHeading id="openapi">
					{t("sections.openapi.title", "OpenAPI specification")}
				</SectionHeading>
				<p className="text-sm text-muted-foreground">
					{t("sections.openapi.body", "")}
				</p>
				<CodeBlock code={"docs/api/openapi.yaml"} />
			</section>
		</div>
	);
}
