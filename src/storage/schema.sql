-- TrendLab Canonical Database Schema (SQLite 3)
-- Compliant with PROJECT_SPECIFICATION.md Section 8

PRAGMA foreign_keys = ON;

-- 1. Canonical Applications (Cross-platform entity)
CREATE TABLE IF NOT EXISTS canonical_applications (
    id TEXT PRIMARY KEY,                       -- UUID
    universal_name TEXT NOT NULL,
    verified_homepage TEXT,
    developer_group_name TEXT,
    first_discovered_at TIMESTAMP NOT NULL,
    verification_status TEXT DEFAULT 'UNVERIFIED', -- UNVERIFIED | LINKED | CONFIRMED
    notes TEXT
);

-- 2. Platform Specific Applications
CREATE TABLE IF NOT EXISTS platform_applications (
    id TEXT PRIMARY KEY,                       -- UUID
    canonical_id TEXT,                         -- Foreign key to canonical_applications
    platform TEXT NOT NULL,                    -- 'android' | 'ios'
    native_store_id TEXT NOT NULL,             -- package_name (Android) or adam_id (iOS)
    storefront TEXT DEFAULT 'global',          -- 'global' | 'us' | 'vn' etc.
    title TEXT NOT NULL,
    developer_id TEXT,
    developer_name TEXT,
    primary_genre TEXT NOT NULL,
    genres_json TEXT,                          -- JSON array of all genre tags
    price REAL DEFAULT 0.0,
    currency TEXT DEFAULT 'USD',
    is_active INTEGER DEFAULT 1,
    first_seen_at TIMESTAMP NOT NULL,
    last_crawled_at TIMESTAMP,
    UNIQUE(platform, native_store_id, storefront),
    FOREIGN KEY (canonical_id) REFERENCES canonical_applications(id) ON DELETE SET NULL
);

-- Index for rapid store lookup
CREATE INDEX IF NOT EXISTS idx_platform_app_native ON platform_applications(platform, native_store_id);

-- 3. Immutable Raw Snapshots Vault
CREATE TABLE IF NOT EXISTS raw_snapshots (
    id TEXT PRIMARY KEY,                       -- UUID
    platform_app_id TEXT NOT NULL,
    observed_at TIMESTAMP NOT NULL,
    source_updated_at TIMESTAMP,
    source_name TEXT NOT NULL,                 -- 'google-play-scraper' | 'itunes-lookup' | 'apple-rss'
    fetch_method TEXT NOT NULL,                -- 'DIRECT_API' | 'WEB_HTML' | 'BATCH_LOOKUP'
    payload_sha256 TEXT NOT NULL,
    raw_payload_json TEXT NOT NULL,
    FOREIGN KEY (platform_app_id) REFERENCES platform_applications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_app_time ON raw_snapshots(platform_app_id, observed_at);

-- 4. Observed Numeric Time Series Metrics
CREATE TABLE IF NOT EXISTS observed_metrics (
    id TEXT PRIMARY KEY,                       -- UUID
    platform_app_id TEXT NOT NULL,
    observed_at TIMESTAMP NOT NULL,
    observed_install_counter INTEGER,          -- From maxInstalls on Android
    observed_rating_count INTEGER,             -- Total user ratings count
    observed_review_count INTEGER,             -- Total written reviews count
    observed_rating_score REAL,                -- Average rating (1.0 - 5.0)
    observed_rank INTEGER,                     -- Rank in chart if applicable
    rank_chart_type TEXT,                      -- e.g. 'TOP_FREE_EDUCATION'
    storefront TEXT,                           -- Storefront of observation
    data_quality_flags TEXT,                   -- JSON flags e.g. ['POSSIBLE_BATCH_UPDATE']
    FOREIGN KEY (platform_app_id) REFERENCES platform_applications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metrics_app_time ON observed_metrics(platform_app_id, observed_at);

-- 5. Derived Window Metrics
CREATE TABLE IF NOT EXISTS derived_window_metrics (
    id TEXT PRIMARY KEY,                       -- UUID
    platform_app_id TEXT NOT NULL,
    window_type TEXT NOT NULL,                 -- '7d' | '14d' | '30d' | '90d' | 'all'
    window_start TIMESTAMP NOT NULL,
    window_end TIMESTAMP NOT NULL,
    delta_install_counter INTEGER,
    delta_rating_count INTEGER,
    rating_velocity_daily REAL,
    rank_delta INTEGER,
    relative_growth REAL,
    dampened_growth REAL,
    momentum_score REAL,
    acceleration_score REAL,
    persistence_ratio REAL,
    theil_sen_slope REAL,
    observation_completeness REAL,             -- Ratio of observed days / expected days
    computed_at TIMESTAMP NOT NULL,
    FOREIGN KEY (platform_app_id) REFERENCES platform_applications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_derived_app_window ON derived_window_metrics(platform_app_id, window_type);

-- 6. Trend Model Scores
CREATE TABLE IF NOT EXISTS trend_model_scores (
    id TEXT PRIMARY KEY,                       -- UUID
    platform_app_id TEXT NOT NULL,
    window_type TEXT NOT NULL,
    model_identifier TEXT NOT NULL,            -- 'model_a_growth' | 'model_b_compounder' | 'model_c_breakout'
    growth_strength REAL,
    momentum_score REAL,
    persistence_score REAL,
    final_trend_score REAL NOT NULL,
    trend_rank INTEGER,
    evaluation_flags TEXT,                     -- JSON
    evaluated_at TIMESTAMP NOT NULL,
    FOREIGN KEY (platform_app_id) REFERENCES platform_applications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trend_scores_window ON trend_model_scores(window_type, model_identifier, trend_rank);

-- 7. Collection Audit Logs
CREATE TABLE IF NOT EXISTS collection_audit_logs (
    id TEXT PRIMARY KEY,                       -- UUID
    job_type TEXT NOT NULL,                    -- 'SWEEP' | 'POLL_ANDROID' | 'POLL_IOS' | 'SEED'
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    status TEXT NOT NULL,                      -- 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED'
    items_attempted INTEGER DEFAULT 0,
    items_succeeded INTEGER DEFAULT 0,
    items_failed INTEGER DEFAULT 0,
    error_summary TEXT
);

-- Persistent per-app collection cursor. Scheduling does NOT depend on last_crawled_at:
-- catalog imports/metadata refreshes are not evidence of metric collection.
CREATE TABLE IF NOT EXISTS collection_state (
    platform_app_id TEXT NOT NULL,
    storefront TEXT NOT NULL,
    last_attempted_at TEXT,
    last_success_at TEXT,
    next_due_at TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (platform_app_id, storefront),
    FOREIGN KEY (platform_app_id) REFERENCES platform_applications(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_collection_due ON collection_state(next_due_at);

-- Online index upgrades for large, pre-existing local catalogs.
CREATE INDEX IF NOT EXISTS idx_platform_due_catalog
  ON platform_applications(platform, is_active, first_seen_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_collection_store_due
  ON collection_state(storefront, next_due_at, last_attempted_at);
CREATE INDEX IF NOT EXISTS idx_observed_app_store_time
  ON observed_metrics(platform_app_id, storefront, observed_at);
CREATE INDEX IF NOT EXISTS idx_metrics_store_app
  ON observed_metrics(storefront, platform_app_id);
