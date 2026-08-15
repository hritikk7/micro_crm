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
    urgency         TEXT        CHECK (urgency IN ('hot', 'watch', 'stable', 'stale')),
                                -- user-selected on the Quick Log Form; NULL for
                                -- interactions logged via chat (chat doesn't set urgency)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Queries: all interactions for a company (dashboard + agent)
CREATE INDEX idx_interactions_company     ON interactions(company_id);
-- Queries: most recent interaction per company (recency)
CREATE INDEX idx_interactions_company_date ON interactions(company_id, date DESC);
-- Agent queries: search interactions by contact
CREATE INDEX idx_interactions_contact     ON interactions(contact_id);

-- ─────────────────────────────────────────────
-- company_scores
-- Stores the current urgency state per company, as picked by the user.
-- Written whenever a Quick Log Form submission includes an urgency label.
-- Read by the dashboard — no AI calls at read time.
-- ─────────────────────────────────────────────
CREATE TABLE company_scores (
    id           BIGSERIAL   PRIMARY KEY,
    company_id   TEXT        NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    urgency      TEXT        NOT NULL
                 CHECK (urgency IN ('hot', 'watch', 'stable', 'stale')),
    urgency_rank INTEGER     NOT NULL,   -- hot=1, watch=2, stable=3, stale=4
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard primary query: all scores ranked
CREATE INDEX idx_company_scores_rank  ON company_scores(urgency_rank ASC);
-- Upsert-on-log query
CREATE INDEX idx_company_scores_co_id ON company_scores(company_id);
