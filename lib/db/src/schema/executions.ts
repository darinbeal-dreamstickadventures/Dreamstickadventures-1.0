import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const executionsTable = pgTable("executions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  exitCode: integer("exit_code").notNull(),
  durationMs: integer("duration_ms").notNull(),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
});

export const insertExecutionSchema = createInsertSchema(executionsTable).omit({ id: true, executedAt: true });
export type InsertExecution = z.infer<typeof insertExecutionSchema>;
export type Execution = typeof executionsTable.$inferSelect;
