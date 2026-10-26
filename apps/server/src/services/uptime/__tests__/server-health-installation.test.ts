import { describe, expect, it, vi } from "vitest";
import { AGENT_CREDENTIAL_PLACEHOLDER, serverInstallation } from "../server-health-installation";
vi.mock("../../../lib/auth-config", () => ({ PUBLIC_WEB_URL: "https://configured-monitor.example:8443/dashboard" }));

describe("server-health installation commands", () => {
  it("defaults to the configured deployment origin and keeps credentials as placeholders", () => {
    const setup = serverInstallation();
    expect(setup.origin).toBe("https://configured-monitor.example:8443");
    expect(setup.installerUrl).toBe("https://configured-monitor.example:8443/api/agent/releases/v1.0.0/install.sh");
    expect(setup.systemdCredentialCommand).toContain(AGENT_CREDENTIAL_PLACEHOLDER);
    expect(setup.composeCredentialCommand).toContain(AGENT_CREDENTIAL_PLACEHOLDER);
    expect(setup.systemdCommand).toContain("--proto '=https' --tlsv1.2");
    expect(setup.composeCommand).toContain("--proto '=https' --tlsv1.2");
  });
  it("uses the configured origin and versioned distribution, without credentials", () => {
    const setup = serverInstallation("https://monitor.example.invalid:8443/dashboard");
    expect(setup.origin).toBe("https://monitor.example.invalid:8443");
    expect(setup.installerUrl).toBe("https://monitor.example.invalid:8443/api/agent/releases/v1.0.0/install.sh");
    expect(setup.systemdCommand).toContain("$(mktemp)");
    expect(setup.composeCommand).toContain("--compose 'https://monitor.example.invalid:8443'");
    expect(setup.requiresHttps).toBe(false);
    expect(serverInstallation("http://localhost:3000").requiresHttps).toBe(true);
  });

  it("pipes a credential placeholder through stdin for the unattended commands", () => {
    const setup = serverInstallation("https://pulsy.example");
    expect(setup.systemdCommand).not.toContain("--credential-stdin");
    expect(setup.systemdCredentialCommand).toContain(`&& printf '%s\\n' '${AGENT_CREDENTIAL_PLACEHOLDER}' | sudo bash "$installer" --credential-stdin 'https://pulsy.example'; rm -f "$installer"`);
    expect(setup.composeCredentialCommand).toContain(`| sudo bash "$installer" --compose --credential-stdin 'https://pulsy.example';`);
  });
});
