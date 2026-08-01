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
import {
	Table,
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

const METHOD_STYLES: Record<HttpMethod, string> = {
	GET: "bg-green-50 text-green-900 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-900/40",
	POST: "bg-blue-50 text-blue-900 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-900/40",
	PATCH:
		"bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/40",
	DELETE:
		"bg-red-50 text-red-900 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/40",
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
		<section
			id={`endpoint-${endpoint.id}`}
			className="scroll-mt-20 rounded-lg border bg-card p-4 sm:p-5"
		>
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<Badge
						variant="outline"
						className={cn("font-mono text-xs", METHOD_STYLES[endpoint.method])}
					>
						{endpoint.method}
					</Badge>
					<code
						dir="ltr"
						className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground"
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

				<div>
					<h3 className="text-base font-semibold">
						{t(`endpointDocs.${endpoint.id}.summary`, endpoint.id)}
					</h3>
					<p className="mt-1 text-sm text-muted-foreground">
						{t(`endpointDocs.${endpoint.id}.description`, "")}
					</p>
				</div>

				{endpoint.params.length > 0 && (
					<div className="flex flex-col gap-2">
						<h4 className="text-sm font-medium">
							{t("endpoint.paramsTitle", "Parameters")}
						</h4>
						<div className="overflow-x-auto rounded-md border">
							<Table>
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
							</Table>
						</div>
					</div>
				)}

				{endpoint.body && (
					<div className="flex flex-col gap-2">
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
						<div className="overflow-x-auto rounded-md border">
							<Table>
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
							</Table>
						</div>
					</div>
				)}

				<CodeBlock
					code={request}
					label={t("endpoint.requestTitle", "Example request")}
				/>
				<CodeBlock
					code={response}
					label={t("endpoint.responseTitle", "Example response")}
				/>
			</div>
		</section>
	);
}
