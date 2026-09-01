-- 001_init.sql

CREATE TABLE IF NOT EXISTS api_keys (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT        NOT NULL,
    key_hash       TEXT        NOT NULL UNIQUE,
    key_prefix     TEXT        NOT NULL,
    budget_nanos   BIGINT      NOT NULL CHECK (budget_nanos >= 0),
    spent_nanos    BIGINT      NOT NULL DEFAULT 0 CHECK (spent_nanos >= 0),
    reserved_nanos BIGINT      NOT NULL DEFAULT 0 CHECK (reserved_nanos >= 0),
    disabled       BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ
);


CREATE TABLE IF NOT EXISTS reservations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id        UUID        NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    request_id    TEXT        NOT NULL,
    amount_nanos  BIGINT      NOT NULL CHECK (amount_nanos >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    released_at   TIMESTAMPTZ
);


CREATE INDEX IF NOT EXISTS reservations_active_idx
    ON reservations (key_id, expires_at)
    WHERE released_at IS NULL;


CREATE TABLE IF NOT EXISTS usage_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id         UUID        NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    request_id     TEXT        NOT NULL,
    attempt_index  INT         NOT NULL DEFAULT 0,
    provider       TEXT        NOT NULL,
    model          TEXT        NOT NULL,
    input_tokens   INT         NOT NULL DEFAULT 0,
    output_tokens  INT         NOT NULL DEFAULT 0,
    cost_nanos     BIGINT      NOT NULL DEFAULT 0 CHECK (cost_nanos >= 0),
    usage_source   TEXT        NOT NULL DEFAULT 'provider'
                   CHECK (usage_source IN ('provider', 'estimated', 'none')),
    status         TEXT        NOT NULL CHECK (status IN ('ok', 'error')),
    error_class    TEXT,
    error_message  TEXT,
    latency_ms     INT         NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_key_time_idx
    ON usage_events (key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_request_idx
    ON usage_events (request_id);

