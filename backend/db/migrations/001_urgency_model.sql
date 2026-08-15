-- Migration 001: Urgency model (TRD v1.1)
--
-- Replaces the AI priority-scoring engine with user-set urgency.
-- Run this once in the Supabase SQL editor, then re-seed (db/seed.py) —
-- company_scores has 0 rows in production at the time of writing, so
-- dropping and recreating it is safe; nothing to migrate.
--
-- After this runs, db/schema.sql describes the same end state — the two
-- must be kept in sync by eye (no migration framework in this project).

-- ─────────────────────────────────────────────
-- interactions: add urgency (nullable — NULL for chat-logged interactions,
-- set for interactions logged via the Quick Log Form)
-- ─────────────────────────────────────────────
ALTER TABLE interactions
    ADD COLUMN urgency TEXT
    CHECK (urgency IN ('hot', 'watch', 'stable', 'stale'));

-- ─────────────────────────────────────────────
-- company_scores: drop the old AI-scoring-cache shape, recreate as the
-- current-urgency-state table described in TRD v1.1 §2.1/§3.
-- ─────────────────────────────────────────────
DROP TABLE IF EXISTS company_scores CASCADE;

CREATE TABLE company_scores (
    id           BIGSERIAL   PRIMARY KEY,
    company_id   TEXT        NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    urgency      TEXT        NOT NULL
                 CHECK (urgency IN ('hot', 'watch', 'stable', 'stale')),
    urgency_rank INTEGER     NOT NULL,   -- hot=1, watch=2, stable=3, stale=4
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_company_scores_rank  ON company_scores(urgency_rank ASC);
CREATE INDEX idx_company_scores_co_id ON company_scores(company_id);
