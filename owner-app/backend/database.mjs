export function database(binding) {
  const stmt = (sql, args) => binding.prepare(sql).bind(...args)
  return {
    one: (sql, ...args) => stmt(sql, args).first(),
    all: async (sql, ...args) => (await stmt(sql, args).all()).results,
    run: async (sql, ...args) => (await stmt(sql, args).run()).meta.changes,
    batch: statements => binding.batch(statements.map(([sql, ...args]) => stmt(sql, args))),
  }
}

export const STAFF_FIELDS = `id, name, role, active, code_digits AS codeDigits,
  niss_last_four AS nissLastFour, created_at AS createdAt`

export const ENTRY_FIELDS = `t.id, t.staff_id AS staffId, t.clock_in AS clockIn, t.clock_out AS clockOut,
  t.original_in AS originalIn, t.original_out AS originalOut, t.approved_at AS approvedAt,
  t.reason, t.corrections, t.revision, s.name, s.role`

export const SHIFT_FIELDS = `s.id, s.staff_id AS staffId, s.start_at AS startAt, s.end_at AS endAt,
  s.role, s.note, s.revision, p.revision AS publishedRevision, p.published_at AS publishedAt,
  m.status AS smsStatus`
