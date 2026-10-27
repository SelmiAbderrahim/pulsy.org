import { SectionCard } from "@/components/ui/section-card";
/**
 * Renders one REST endpoint: method + path, access badge, description,
 * parameter and request-body tables, and example request/response.
 *
 * Method/path/types are literal; summaries, descriptions and parameter/field
 * explanations come from the `apiDocs` namespace (keyed by endpoint id).
 *
 * @module components/uptime/api-docs/endpoint-section
 */

import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { DocsHelpLink } from "@/components/ui/docs-help-link";
import {
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
	BODY_FIELDS,
	type EndpointDescriptor,
	type HttpMethod,
} from "./api-endpoints";
import { CodeBlock } from "./code-block";
import { ApiDocsTable } from "./api-docs-table";

const METHOD_STYLES: Record<HttpMethod, string> = {
	GET: "bg-success/10 text-success border-success",
	POST: "bg-primary/10 text-primary border-primary",
	PATCH:
		"bg-warning/10 text-warning border-warning",
	DELETE:
		"bg-destructive/10 text-destructive border-destructive",
};

interface EndpointSectionProps {
	endpoint: EndpointDescriptor;
	/** Live base URL substituted into `{{base}}` placeholders in samples. */
	apiBase: string;
}

export function EndpointSection({ endpoint, apiBase }: EndpointSectionProps) {
	const { t } = useTranslation("apiDocs");

	const request = endpoint.requestSample.replaceAll("{{base}}", apiBase);
	const response = endpoint.responseSample.replaceAll("{{base}}", apiBase);

	return (
		<SectionCard id={`endpoint-${endpoint.id}`} className="scroll-mt-20" headingLevel="h3"
      title={t(`endpointDocs.${endpoint.id}.summary`, endpoint.id)}
      description={t(`endpointDocs.${endpoint.id}.description`, "")}
      headerEnd={endpoint.id === "metrics" ? <DocsHelpLink docPath="prometheus" /> : undefined}>
			<div className="flex min-w-0 flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<Badge
						variant="outline"
						className={cn("font-mono text-xs", METHOD_STYLES[endpoint.method])}
					>
						{endpoint.method}
					</Badge>
					<code
						dir="ltr"
						className="min-w-0 break-all rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground"
					>
						{endpoint.path}
					</code>
					<Badge variant="secondary" className="ms-auto gap-1.5 text-xs">
						{t("endpoint.accessLabel", "Access")}:{" "}
						{endpoint.access === "write"
							? t("endpoint.write", "write")
							: t("endpoint.read", "read")}
					</Badge>
				</div>


				{endpoint.params.length > 0 && (
					<div className="flex min-w-0 flex-col gap-2">
						<h4 className="text-sm font-medium">
							{t("endpoint.paramsTitle", "Parameters")}
						</h4>
				<ApiDocsTable aria-label={`${endpoint.method} ${endpoint.path}`}>
								<TableHeader>
									<TableRow>
										<TableHead className="text-start">
											{t("endpoint.colName", "Name")}
										</TableHead>
										<TableHead className="text-start">
											{t("endpoint.colIn", "In")}
										</TableHead>
										<TableHead className="text-start">
											{t("endpoint.colType", "Type")}
										</TableHead>
										<TableHead className="text-start">
											{t("endpoint.colRequired", "Required")}
										</TableHead>
										<TableHead className="text-start">
											{t("endpoint.colDescription", "Description")}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{endpoint.params.map((param) => (
										<TableRow key={param.name}>
											<TableCell>
												<code className="font-mono text-xs">{param.name}</code>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{param.in}
											</TableCell>
											<TableCell className="font-mono text-xs text-muted-foreground">
												{param.type}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{param.required
													? t("endpoint.required", "Required")
													: t("endpoint.optional", "Optional")}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{t(`endpoint.${param.descKey}`, "")}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</ApiDocsTable>
					</div>
				)}

				{endpoint.body && (
					<div className="flex min-w-0 flex-col gap-2">
						<h4 className="text-sm font-medium">
							{t("endpoint.bodyTitle", "Request body")}
						</h4>
						<p className="text-xs text-muted-foreground">
							{endpoint.body === "create"
								? t(
										"endpoint.bodyCreateNote",
										"name and url are required; all other fields are optional.",
									)
								: t(
										"endpoint.bodyUpdateNote",
										"All fields are optional — only the fields you send are updated.",
									)}
						</p>
				<ApiDocsTable aria-label={`${endpoint.method} ${endpoint.path}`}>
								<TableHeader>
									<TableRow>
										<TableHead className="text-start">
											{t("endpoint.colField", "Field")}
										</TableHead>
										<TableHead className="text-start">
											{t("endpoint.colType", "Type")}
										</TableHead>
										<TableHead className="text-start">
											{t("endpoint.colDescription", "Description")}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{BODY_FIELDS.map((field) => (
										<TableRow key={field.name}>
											<TableCell>
												<code className="font-mono text-xs">{field.name}</code>
												{endpoint.body === "create" &&
													field.requiredOnCreate && (
														<span className="ms-1 text-xs text-destructive">
															*
														</span>
													)}
											</TableCell>
											<TableCell className="font-mono text-xs text-muted-foreground">
												{field.type}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{t(`endpoint.bodyFields.${field.name}`, "")}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</ApiDocsTable>
					</div>
				)}

				<CodeBlock
					code={request} language="bash"
					label={t("endpoint.requestTitle", "Example request")}
				/>
				<CodeBlock
					code={response} language={endpoint.id === "metrics" ? "text" : "json"}
					label={`${t("endpoint.responseTitle", "Example response")}${endpoint.responseStatus ? ` — ${endpoint.responseStatus}` : ""}`}
				/>
			</div>
		</SectionCard>
	);
}
