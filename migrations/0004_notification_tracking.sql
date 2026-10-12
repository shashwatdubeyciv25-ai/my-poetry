-- Migration: 0004_notification_tracking.sql
-- Enhanced Delivery Tracking & Diagnostics for Email Notifications

-- Add provider tracking and delivery confirmation columns to poem_notifications
ALTER TABLE poem_notifications ADD COLUMN provider_message_id TEXT;
ALTER TABLE poem_notifications ADD COLUMN provider TEXT;
ALTER TABLE poem_notifications ADD COLUMN delivered_at INTEGER;
ALTER TABLE poem_notifications ADD COLUMN retry_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_poem_notifications_msg_id ON poem_notifications(provider_message_id);
