import { timestamp } from "drizzle-orm/pg-core";

/*
 * Timestamps comunes (UTC, `timestamptz`). `updated_at` lo actualiza Drizzle
 * en cada `update()`; un UPDATE por SQL directo no lo toca.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
