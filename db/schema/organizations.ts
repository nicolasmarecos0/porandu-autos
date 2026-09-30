import { sql } from "drizzle-orm";
import { pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole } from "drizzle-orm/supabase";

import { timestamps } from "./columns";
import { userOrgIds } from "./policies";

/*
 * Raíz del tenant (ADR-001 §3.6). No lleva `organization_id`: toda tabla
 * tenant-scoped apunta a esta con FK.
 *
 * Lectura: las organizaciones donde el usuario tiene membership activa.
 * Sin policies de escritura (default deny).
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [
    pgPolicy("organizations_select_member", {
      for: "select",
      to: authenticatedRole,
      using: sql`${t.id} IN ${userOrgIds}`,
    }),
  ],
).enableRLS();
