import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Route } from "./dashboard_.help.$topic";
import { Route as HelpIndexRoute } from "./dashboard_.help";
const state = vi.hoisted(() => ({ language: "en", topic: "status-communication", nested: false }));
vi.mock("@tanstack/react-router", () => ({ useMatch: () => state.nested ? {} : undefined, Outlet: () => <p>Article outlet</p>, createFileRoute: () => (config: { component: () => React.ReactNode }) => ({ options: config, useParams: () => ({ topic: state.topic }) }), redirect: (options: unknown) => ({ options }), Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: state.language, language: state.language } }) }));
afterEach(() => { cleanup(); state.topic = "status-communication"; state.language = "en"; state.nested = false; });
describe("bundled localized status communication guide", () => {
  for (const [language, heading] of [["en", "Public status-page communication"], ["ar", "التواصل عبر صفحة الحالة العامة"], ["fr", "Communication sur la page de statut publique"], ["de", "Mitteilungen auf der öffentlichen Statusseite"], ["es", "Comunicación en la página de estado pública"]]) {
    it(`serves the full guide in ${language} with its reading direction`, () => {
      state.language = language!;
      const Component = Route.options.component!;
      render(<Component />);
      const content = screen.getByRole("heading", { level: 1, name: heading! }).closest(".help-prose")!;
      expect(content).toHaveAttribute("lang", language);
      expect(content).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr");
      expect(content.querySelectorAll("h2").length).toBeGreaterThanOrEqual(5);
      expect(content).toHaveTextContent("RSS");
      expect(content).toHaveTextContent("Atom");
      expect(content.textContent).not.toMatch(/Operator guidance|Guide opérateur|Betriebshinweise|Guía del operador|إرشادات المشغّل|00[12][0-9]_/);
      expect(screen.queryByText("help.language")).toBeNull();
    });
  }
  it("treats inherited object names as unknown topics with localized reading direction", () => {
    state.topic = "constructor"; state.language = "ar";
    const Component = Route.options.component!;
    render(<Component />);
    expect(screen.getByText("help.missing")).toHaveAttribute("lang", "ar");
    expect(screen.getByText("help.missing")).toHaveAttribute("dir", "rtl");
  });
  for (const [topic, language, heading] of [

    ["server-monitoring", "en", "Linux server"],
    ["server-monitoring", "fr", "Serveur Linux"],
    ["server-monitoring", "de", "Linux-Server"],
    ["server-monitoring", "es", "Servidor Linux"],
    ["server-monitoring", "ar", "خادم Linux"],
    ["saved-views", "ar", "العروض الشخصية المحفوظة والمجموعات"],
    ["saved-views", "fr", "Vues personnelles enregistrées et groupes"],
    ["saved-views", "de", "Persönliche gespeicherte Ansichten und Gruppen"],
    ["saved-views", "es", "Vistas personales guardadas y grupos"],
    ["heartbeat", "ar", "إشارات النبض بفاصل زمني"],
    ["heartbeat", "fr", "Heartbeats à intervalle"],
    ["heartbeat", "de", "Heartbeats mit Intervall"],
    ["heartbeat", "es", "Heartbeats por intervalo"],
    ["incidents", "ar", "الاستجابة الشخصية للحوادث"],
    ["incidents", "fr", "Réponse personnelle aux incidents"],
    ["incidents", "de", "Persönliche Reaktion auf Vorfälle"],
    ["incidents", "es", "Respuesta personal a incidentes"],
    ["maintenance", "ar", "نوافذ الصيانة وكتم التنبيهات"],
    ["maintenance", "fr", "Maintenance et suspension des alertes"],
    ["maintenance", "de", "Wartungsfenster und Alarmunterbrechung"],
    ["maintenance", "es", "Mantenimiento y suspensión de alertas"],
    ["http-checks", "ar", "فحوص HTTP المتقدمة"],
    ["http-checks", "fr", "Contrôles HTTP avancés"],
    ["http-checks", "de", "Erweiterte HTTP-Prüfungen"],
    ["http-checks", "es", "Comprobaciones HTTP avanzadas"],
    ["latency-alerts", "ar", "تدهور زمن الاستجابة والتعافي المستقر"],
    ["latency-alerts", "fr", "Dégradation de latence et rétablissement stable"],
    ["latency-alerts", "de", "Latenzverschlechterung und ruhige Erholung"],
    ["latency-alerts", "es", "Degradación por latencia y recuperación estable"],
    ["dns-tcp", "en", "DNS and TCP monitoring"],
    ["dns-tcp", "ar", "مراقبة DNS وTCP"],
    ["reliability", "en", "Reliability goals and event context"],
    ["prometheus", "en", "Prometheus output"],
    ["prometheus", "ar", "مخرجات Prometheus"],
    ["prometheus", "fr", "Export Prometheus"],
    ["prometheus", "de", "Prometheus-Ausgabe"],
    ["prometheus", "es", "Salida de Prometheus"],
    ["reliability", "ar", "أهداف الموثوقية وسياق الأحداث"],
    ["reliability", "fr", "Objectifs de fiabilité et contexte des événements"],
    ["reliability", "de", "Zuverlässigkeitsziele und Ereigniskontext"],
    ["reliability", "es", "Objetivos de fiabilidad y contexto de eventos"],
    ["dns-tcp", "fr", "Surveillance DNS et TCP"],
    ["dns-tcp", "de", "DNS- und TCP-Monitoring"],
    ["dns-tcp", "es", "Monitorización DNS y TCP"],
    ["configuration-portability", "en", "Import & export"],
    ["configuration-portability", "ar", "الاستيراد والتصدير"],
    ["configuration-portability", "fr", "Importer et exporter"],
    ["configuration-portability", "de", "Importieren und exportieren"],
    ["configuration-portability", "es", "Importar y exportar"],
  ]) {
    it(`renders the ${topic} guide in ${language}`, () => {
      state.topic = topic!; state.language = language!;
      const Component = Route.options.component!; render(<Component />);
      const content = screen.getByRole("heading", { level: 1, name: heading! }).closest(".help-prose")!;
      expect(content).toHaveAttribute("lang", language);
      expect(content).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr");
      expect(screen.queryByText("help.language")).toBeNull();
    });
  }
});

describe("help index groups and related-topic navigation", () => {
  const SHIPPED = ["server-monitoring", "http-checks", "dns-tcp", "heartbeat", "latency-alerts", "reliability", "maintenance", "saved-views", "incidents", "status-communication", "configuration-portability", "prometheus"];
  it.each(["en", "ar", "fr", "de", "es"])("lists every shipped article exactly once under a task group in %s, each with a one-line summary", language => {
    state.topic = "index"; state.language = language;
    const Component = Route.options.component!; const { container } = render(<Component />);
    const sections = [...container.querySelectorAll("section[aria-labelledby^=help-group-]")];
    expect(sections.map(section => section.getAttribute("aria-labelledby"))).toEqual(["help-group-monitoring", "help-group-incidents", "help-group-communication", "help-group-integrations"]);
    const links = [...container.querySelectorAll("section a")].map(link => link.getAttribute("href") ?? link.getAttribute("data-topic") ?? link.textContent);
    expect(links).toHaveLength(SHIPPED.length);
    for (const item of container.querySelectorAll("section a")) expect(item.textContent!.length).toBeGreaterThan(30);
  });
  it("shows only same-group siblings plus the index at the end of an article", () => {
    state.topic = "heartbeat"; state.language = "en";
    const Component = Route.options.component!; render(<Component />);
    const more = screen.getByRole("navigation", { name: "help.moreTopics" });
    expect(more).toHaveTextContent("help.moreIn");
    expect(more.querySelectorAll("a").length).toBe(8);
    expect(more).toHaveTextContent("help.allTopics");
  });
});



it("filters Help articles with AND token matching across title and body", () => {
  state.topic="index";
  const Component=Route.options.component!;
  const {container}=render(<Component />);
  fireEvent.change(screen.getByRole("searchbox",{name:"help.search"}),{target:{value:"heartbeat grace"}});
  const matches=container.querySelectorAll("section a");
  expect([...matches].some(match => match.textContent?.includes("Job heartbeat"))).toBe(true);
  fireEvent.change(screen.getByRole("searchbox",{name:"help.search"}),{target:{value:"heartbeat ping url"}});
  expect([...container.querySelectorAll("section a")].some(match => match.textContent?.includes("Job heartbeat"))).toBe(true);
  fireEvent.change(screen.getByRole("searchbox",{name:"help.search"}),{target:{value:"heartbeat,zzzz"}});
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"help.reportIssue"})).toHaveAttribute("href","https://github.com/SelmiAbderrahim/pulsy/issues");
});

it("links each article contents entry to its rendered heading", () => {
  state.topic="status-communication";
  const Component=Route.options.component!;
  const {container}=render(<Component />);
  const contents=screen.getByRole("navigation",{name:"help.contents"});
  for(const link of contents.querySelectorAll("a")) {
    const target=container.querySelector(`[id="${link.getAttribute("href")!.slice(1)}"]`);
    expect(target).toHaveTextContent(link.textContent!);
  }
  expect(contents.querySelectorAll("a").length).toBeGreaterThan(1);
});

it("uses /dashboard/help as the canonical index and redirects the legacy index path", () => {
  state.topic = "index";
  const Component = HelpIndexRoute.options.component!;
  render(<Component />);
  expect(screen.getByRole("heading", { level: 1, name: "help.title" })).toBeInTheDocument();
  let caught: unknown;
  try { Route.options.beforeLoad!({ params: { topic: "index" } } as never); } catch (error) { caught = error; }
  expect(caught).toMatchObject({ options: { to: "/dashboard/help", replace: true } });
});

it("renders nested article and missing-topic routes through the help layout outlet", () => {
  state.nested = true;
  const Component = HelpIndexRoute.options.component!;
  render(<Component />);
  expect(screen.getByText("Article outlet")).toBeInTheDocument();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
