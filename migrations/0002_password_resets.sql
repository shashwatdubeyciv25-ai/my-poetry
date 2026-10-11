-- Migration: 0002_password_resets.sql
-- Ashabd (अशब्द) Password Reset Tokens & Admin Email

-- Add email column to admin_users table if not present
ALTER TABLE admin_users ADD COLUMN email TEXT;

-- Table for single-use, time-expiring hashed password reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  ip_address TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);
