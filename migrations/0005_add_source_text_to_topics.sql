-- Add source_text column to topics table
-- This stores the actual relevant content from the PDF for each topic
ALTER TABLE topics ADD COLUMN source_text TEXT;
