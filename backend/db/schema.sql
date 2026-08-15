-- Micro-CRM schema. 
-- Source of truth for table shape — db/models.py must be kept in sync

-- DROP TABLE IF EXISTS company_scores, interactions, contacts, companies CASCADE;

-- ─────────────────────────────────────────────
-- companies
-- ─────────────────────────────────────────────
CREATE TABLE companies (
    id          TEXT        PRIMARY KEY,        -- e.g. "C001"
    name        TEXT        NOT NULL,
    industry    TEXT,
    status      TEXT        NOT NULL            -- 'prospect' | 'customer'
                CHECK (status IN ('prospect', 'customer')),
    size        INTEGER,                        -- employee count
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- contacts
-- ─────────────────────────────────────────────
CREATE TABLE contacts (
    id          TEXT        PRIMARY KEY,        -- e.g. "P001"
    company_id  TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    role        TEXT,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contacts_company ON contacts(company_id);

-- ─────────────────────────────────────────────
-- interactions
-- ─────────────────────────────────────────────
CREATE TABLE interactions (
    id              BIGSERIAL   PRIMARY KEY,
    company_id      TEXT        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_name    TEXT,                       -- denormalised for agent legibility
    contact_id      TEXT        REFERENCES contacts(id) ON DELETE SET NULL,
    date            DATE        NOT NULL,       -- structured date (not free text)
    type            TEXT        NOT NULL        -- 'meeting'|'email'|'call'|'demo'|'support_call'
                    CHECK (type IN ('meeting', 'email', 'call', 'demo', 'support_call')),
    notes           TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queries: all interactions for a company (dashboard + agent)
CREATE INDEX idx_interactions_company     ON interactions(company_id);
-- Queries: most recent interaction per company (recency scoring)
CREATE INDEX idx_interactions_company_date ON interactions(company_id, date DESC);
-- Agent queries: search interactions by contact
CREATE INDEX idx_interactions_contact     ON interactions(contact_id);

-- ─────────────────────────────────────────────
-- company_scores  (AI output cache — populated starting in slice 2)
-- ─────────────────────────────────────────────
CREATE TABLE company_scores (
    id                  BIGSERIAL   PRIMARY KEY,
    company_id          TEXT        NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    urgency             TEXT        NOT NULL
                        CHECK (urgency IN ('hot', 'watch', 'stable', 'stale')),
    reason              TEXT        NOT NULL,   -- one-line AI reason
    recommended_action  TEXT        NOT NULL,   -- specific next step
    ai_brief            TEXT,                   -- 2-3 sentence relationship brief (populated on expand)
    blocker             TEXT,                   -- single blocker (populated on expand)
    priority_rank       INTEGER     NOT NULL DEFAULT 0,
    scored_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    insight_scored_at   TIMESTAMPTZ,            -- separate timestamp for deeper insight
    invalidated_at      TIMESTAMPTZ,            -- set when a new interaction is logged
    interaction_count   INTEGER     NOT NULL DEFAULT 0  -- snapshot at score time (cheap staleness check)
);

-- Dashboard primary query: all scores ranked
CREATE INDEX idx_company_scores_rank   ON company_scores(priority_rank ASC);
-- Invalidation query
CREATE INDEX idx_company_scores_co_id  ON company_scores(company_id);
