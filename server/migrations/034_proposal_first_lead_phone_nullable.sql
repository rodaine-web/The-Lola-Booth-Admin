-- Proposal-first workflows can create an opportunity from an existing client/event.
-- Normal lead-entry API validation still requires a phone number, but internally
-- generated proposal opportunities may use a client that does not have one yet.
ALTER TABLE leads ALTER COLUMN phone DROP NOT NULL;
