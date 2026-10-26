import { PUBLIC_WEB_URL } from "../../lib/auth-config";

/** The browser fills the placeholder only after an explicit owner credential action. */
export const AGENT_CREDENTIAL_PLACEHOLDER = "__PULSY_AGENT_CREDENTIAL__";

/** Deployment configuration only; never derive these commands from request headers. */
export function serverInstallation(origin = PUBLIC_WEB_URL) {
	const configured = new URL(origin).origin;
	const installerUrl = new URL("/api/agent/releases/v1.0.0/install.sh", configured).href;
	const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
	// A shell-builtin printf sends the credential through stdin instead of argv.
	const command = (mode: string, credential = false) =>
		`installer=$(mktemp) && curl --fail --proto '=https' --tlsv1.2 ${quote(installerUrl)} -o "$installer" && ${credential ? `printf '%s\\n' ${quote(AGENT_CREDENTIAL_PLACEHOLDER)} | ` : ""}sudo bash "$installer" ${mode}${credential ? "--credential-stdin " : ""}${quote(configured)}; rm -f "$installer"`;
	return {
		origin: configured,
		installerUrl,
		requiresHttps: !configured.startsWith("https://"),
		systemdCommand: command(""),
		composeCommand: command("--compose "),
		systemdCredentialCommand: command("", true),
		composeCredentialCommand: command("--compose ", true),
	};
}
