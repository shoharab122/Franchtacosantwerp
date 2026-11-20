ALTER TABLE staff ADD COLUMN code_digits INTEGER NOT NULL DEFAULT 6 CHECK (code_digits IN (4, 6));
--> statement-breakpoint
ALTER TABLE time_entries ADD COLUMN signatures TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX time_completed_range ON time_entries(clock_out, clock_in) WHERE clock_out IS NOT NULL;
