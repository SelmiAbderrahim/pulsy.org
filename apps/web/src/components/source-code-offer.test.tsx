import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { reactI18nextMock } from "@/test/i18n-mock";
import {
	DEFAULT_SOURCE_CODE_URL,
	getSourceCodeUrl,
	SourceCodeOffer,
} from "./source-code-offer";

vi.mock("react-i18next", () => reactI18nextMock());

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("SourceCodeOffer", () => {
	it("uses the canonical upstream when no build URL is configured", () => {
		vi.stubEnv("VITE_SOURCE_CODE_URL", "");

		render(<SourceCodeOffer />);

		const link = screen.getByRole("link", {
			name: "Source code for this version",
		});
		expect(link).toHaveAttribute("href", DEFAULT_SOURCE_CODE_URL);
		expect(link).toHaveAttribute("rel", "noopener noreferrer");
	});

	it("links to the exact configured deployment source", () => {
		const deployedSource =
			"https://code.example/pulsy/tree/0123456789abcdef";
		vi.stubEnv("VITE_SOURCE_CODE_URL", `  ${deployedSource}  `);

		render(<SourceCodeOffer />);

		expect(
			screen.getByRole("link", { name: "Source code for this version" }),
		).toHaveAttribute("href", deployedSource);
	});

	it("rejects non-HTTP URL schemes", () => {
		expect(getSourceCodeUrl("javascript:alert(1)")).toBe(
			DEFAULT_SOURCE_CODE_URL,
		);
	});
});
