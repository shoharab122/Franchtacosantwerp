CREATE TABLE staff (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT NOT NULL,
  address_encrypted TEXT NOT NULL,
  niss_encrypted TEXT,
  niss_last_four TEXT,
  code_hash TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE time_entries (
  id TEXT PRIMARY KEY NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  clock_in INTEGER NOT NULL,
  clock_out INTEGER CHECK (clock_out > clock_in),
  original_in INTEGER,
  original_out INTEGER,
  approved_at INTEGER,
  reason TEXT,
  corrections INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX time_one_open ON time_entries(staff_id) WHERE clock_out IS NULL;
--> statement-breakpoint
CREATE INDEX time_staff_range ON time_entries(staff_id, clock_in, clock_out);
--> statement-breakpoint
CREATE TRIGGER time_no_overlap_insert BEFORE INSERT ON time_entries
WHEN EXISTS (
  SELECT 1 FROM time_entries t WHERE t.staff_id = NEW.staff_id
  AND t.clock_in < coalesce(NEW.clock_out, 9223372036854775807)
  AND coalesce(t.clock_out, 9223372036854775807) > NEW.clock_in
)
BEGIN
  SELECT raise(ABORT, 'attendance_overlap');
END;
--> statement-breakpoint
CREATE TRIGGER time_no_overlap_update BEFORE UPDATE OF clock_in, clock_out ON time_entries
WHEN EXISTS (
  SELECT 1 FROM time_entries t WHERE t.id <> NEW.id AND t.staff_id = NEW.staff_id
  AND t.clock_in < coalesce(NEW.clock_out, 9223372036854775807)
  AND coalesce(t.clock_out, 9223372036854775807) > NEW.clock_in
)
BEGIN
  SELECT raise(ABORT, 'attendance_overlap');
END;
--> statement-breakpoint
CREATE TABLE time_corrections (
  entry_id TEXT NOT NULL REFERENCES time_entries(id),
  revision INTEGER NOT NULL,
  previous_in INTEGER NOT NULL,
  previous_out INTEGER,
  next_in INTEGER NOT NULL,
  next_out INTEGER,
  previous_approval INTEGER,
  reason TEXT NOT NULL,
  changed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (entry_id, revision)
);
--> statement-breakpoint
CREATE TRIGGER time_audit_update AFTER UPDATE ON time_entries
WHEN NEW.corrections > OLD.corrections
BEGIN
  INSERT INTO time_corrections (
    entry_id, revision, previous_in, previous_out, next_in, next_out, previous_approval, reason
  ) VALUES (
    NEW.id, NEW.revision, OLD.clock_in, OLD.clock_out, NEW.clock_in, NEW.clock_out, OLD.approved_at, NEW.reason
  );
END;
--> statement-breakpoint
CREATE TABLE shifts (
  id TEXT PRIMARY KEY NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL CHECK (end_at > start_at),
  role TEXT NOT NULL,
  note TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  cancelled_at INTEGER
);
--> statement-breakpoint
CREATE INDEX shift_staff_range ON shifts(staff_id, start_at, end_at);
--> statement-breakpoint
CREATE TRIGGER shift_no_overlap_insert BEFORE INSERT ON shifts
WHEN EXISTS (
  SELECT 1 FROM shifts s WHERE s.staff_id = NEW.staff_id AND s.cancelled_at IS NULL
  AND s.start_at < NEW.end_at AND s.end_at > NEW.start_at
)
BEGIN
  SELECT raise(ABORT, 'shift_overlap');
END;
--> statement-breakpoint
CREATE TRIGGER shift_no_overlap_update BEFORE UPDATE OF staff_id, start_at, end_at ON shifts
WHEN EXISTS (
  SELECT 1 FROM shifts s WHERE s.id <> NEW.id AND s.staff_id = NEW.staff_id
  AND s.cancelled_at IS NULL AND s.start_at < NEW.end_at AND s.end_at > NEW.start_at
)
BEGIN
  SELECT raise(ABORT, 'shift_overlap');
END;
--> statement-breakpoint
CREATE TABLE published_shifts (
  shift_id TEXT PRIMARY KEY NOT NULL REFERENCES shifts(id),
  staff_id TEXT NOT NULL REFERENCES staff(id),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  role TEXT NOT NULL,
  note TEXT NOT NULL,
  revision INTEGER NOT NULL,
  published_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX published_staff_range ON published_shifts(staff_id, start_at, end_at);
--> statement-breakpoint
CREATE TABLE shift_messages (
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitting', 'queued', 'failed', 'uncertain')),
  attempted_at INTEGER NOT NULL,
  provider_id TEXT,
  PRIMARY KEY (shift_id, revision)
);
--> statement-breakpoint
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
