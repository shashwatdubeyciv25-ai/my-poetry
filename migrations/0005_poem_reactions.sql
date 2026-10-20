-- Migration: 0005_poem_reactions.sql
-- Ashabd (अशब्द) Like and Dislike Reaction System for Poems

CREATE TABLE IF NOT EXISTS poem_reactions (
  id TEXT PRIMARY KEY,
  writing_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK(reaction IN ('like', 'dislike')),
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (writing_id) REFERENCES writings(id) ON DELETE CASCADE
);

-- Ensure a visitor can only have one active reaction per poem
CREATE UNIQUE INDEX IF NOT EXISTS idx_poem_reactions_writing_visitor 
  ON poem_reactions(writing_id, visitor_id);

-- Optimize counts per poem & reaction type
CREATE INDEX IF NOT EXISTS idx_poem_reactions_writing_reaction 
  ON poem_reactions(writing_id, reaction);
