-- Migration: 0003_subscribers.sql
-- Ashabd (अशब्द) Email Subscription & Poem Notification System

-- 1. Subscribers table for double opt-in subscriptions & recipient privacy
CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', -- 'pending', 'active', 'unsubscribed'
  verification_token_hash TEXT,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  referrer TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  unsubscribed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
CREATE INDEX IF NOT EXISTS idx_subscribers_verification_token ON subscribers(verification_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscribers_unsubscribe_token ON subscribers(unsubscribe_token);

-- 2. Delivery audit & diagnostic log for automatic poem notifications
CREATE TABLE IF NOT EXISTS poem_notifications (
  id TEXT PRIMARY KEY,
  writing_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'skipped'
  error_message TEXT,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_poem_notifications_writing ON poem_notifications(writing_id);
CREATE INDEX IF NOT EXISTS idx_poem_notifications_subscriber ON poem_notifications(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_poem_notifications_sent_at ON poem_notifications(sent_at DESC);
