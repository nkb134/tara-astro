-- Add WhatsApp message ID to messages table for quoted reply matching
ALTER TABLE messages ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_message_id) WHERE wa_message_id IS NOT NULL;
