import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";

/*
 * Raíz del tenant (ADR-001 §3.6). No lleva `organization_id`: toda tabla
 * tenant-scoped apunta a esta con FK.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
}).enableRLS();
