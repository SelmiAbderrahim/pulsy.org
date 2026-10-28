import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describe, expect, it } from "vitest";
import * as schema from "@pulsy/db";

describe("server-health additive migration", () => {
  it("upgrades a populated OSS master schema and preserves existing monitors", async () => {
    const source = new URL(process.env.DATABASE_URL!);
    if (!/(^|[_-])test($|[_-])/i.test(source.pathname.slice(1))) throw new Error("Migration fixture requires an isolated test database");
    const fixtureName = `pulsy_server_upgrade_test_${randomBytes(6).toString("hex")}`;
    const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1 });
    const directory = await mkdtemp(join(tmpdir(), "pulsy-server-upgrade-"));
    let client: ReturnType<typeof postgres> | undefined;
    try {
      // Identifiers are generated locally, never supplied by a request.
      await admin.unsafe(`CREATE DATABASE "${fixtureName}"`);
      source.pathname = `/${fixtureName}`; client = postgres(source.toString(), { max: 1 });
      const fixture = drizzle(client);
      const migrations = resolve(process.cwd(), "../../packages/db/drizzle");
      const journal = JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8")) as { entries: { tag: string; idx: number }[] };
      const previous = journal.entries.filter(entry => entry.idx < 12);
      await mkdir(join(directory, "meta")); await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({ ...journal, entries: previous }));
      for (const entry of previous) await copyFile(join(migrations, `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
      await migrate(fixture, { migrationsFolder: directory });
      const oldUser = pgTable("user", { id: text("id"), name: text("name"), email: text("email"), emailVerified: boolean("emailVerified"), createdAt: timestamp("createdAt"), updatedAt: timestamp("updatedAt") });
      const oldMonitor = pgTable("uptime_monitor", { uptimeMonitorId: text("uptimeMonitorId"), userId: text("userId"), name: text("name"), url: text("url"), createdAt: text("createdAt") });
      await fixture.insert(oldUser).values({ id: "migration-owner", name: "Fixture", email: "migration@example.invalid", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
      await fixture.insert(oldMonitor).values({ createdAt: new Date().toISOString(), uptimeMonitorId: "existing-site", userId: "migration-owner", name: "Existing HTTP", url: "https://example.invalid" });
      await migrate(fixture, { migrationsFolder: migrations });
      expect((await fixture.select().from(schema.uptimeMonitor))[0]).toMatchObject({ uptimeMonitorId: "existing-site", monitorType: "http", name: "Existing HTTP" });
      expect(await fixture.select().from(schema.uptimeServer)).toHaveLength(0);
      expect(await fixture.select().from(schema.uptimeServerMetric)).toHaveLength(0);
      await migrate(fixture, { migrationsFolder: migrations });
      expect(await fixture.select().from(schema.uptimeMonitor)).toHaveLength(1);
    } finally {
      await client?.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${fixtureName}" WITH (FORCE)`);
      await admin.end({ timeout: 5 }); await rm(directory, { recursive: true, force: true });
    }
  });
});
