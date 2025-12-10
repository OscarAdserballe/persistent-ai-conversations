-- Migration: Learning Schema Simplification
-- Breaking change: Drop old complex schema, create simplified Learning Artifact structure

-- Drop existing indexes
DROP INDEX IF EXISTS `idx_learnings_created`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_learnings_type`;--> statement-breakpoint
DROP INDEX IF EXISTS `idx_learnings_conversation`;--> statement-breakpoint

-- Drop old learnings table
DROP TABLE IF EXISTS `learnings`;--> statement-breakpoint

-- Create new learnings table with simplified schema
CREATE TABLE `learnings` (
	`learning_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`trigger` text NOT NULL,
	`insight` text NOT NULL,
	`why_points` text NOT NULL,
	`faq` text NOT NULL,
	`conversation_uuid` text,
	`embedding` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint

-- Create indexes
CREATE INDEX `idx_learnings_created` ON `learnings` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_learnings_conversation` ON `learnings` (`conversation_uuid`);
