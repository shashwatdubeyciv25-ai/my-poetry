-- Migration: 0001_initial_schema.sql
-- Ashabd (अशब्द) Poetry & Writing Platform - D1 Database Schema

CREATE TABLE IF NOT EXISTS writings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  subtitle TEXT,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'Poetry', -- Poetry, Article, Story, Essay, Diary, Other
  tags TEXT,                                    -- Comma-separated tags
  status TEXT NOT NULL DEFAULT 'Draft',        -- 'Draft' or 'Published'
  cover_image_key TEXT,                         -- Optional cover image URL or R2 key
  created_at INTEGER NOT NULL,                  -- Unix timestamp (ms)
  updated_at INTEGER NOT NULL,                  -- Unix timestamp (ms)
  published_at INTEGER                          -- Unix timestamp (ms)
);

-- Optimize queries for public listing, status filtering, and slug lookups
CREATE INDEX IF NOT EXISTS idx_writings_status ON writings(status);
CREATE INDEX IF NOT EXISTS idx_writings_slug ON writings(slug);
CREATE INDEX IF NOT EXISTS idx_writings_content_type ON writings(content_type);
CREATE INDEX IF NOT EXISTS idx_writings_published_at ON writings(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_writings_updated_at ON writings(updated_at DESC);
