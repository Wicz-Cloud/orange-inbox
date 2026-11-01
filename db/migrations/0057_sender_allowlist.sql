-- Kid-safe inbound: per-mailbox sender allowlist.
--
-- A mailbox with hold_unknown = 1 only accepts mail from senders that match a
-- row in sender_allowlist. Everything else is delivered to the domain's
-- 'held' mailbox instead (admins only, by membership). Nothing is dropped.
--
-- pattern (lowercase): an exact address ('nana@example.com') or a whole
-- domain ('@school.org').

PRAGMA foreign_keys = ON;

ALTER TABLE mailboxes ADD COLUMN hold_unknown INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sender_allowlist (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  pattern    TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (mailbox_id, pattern)
);
