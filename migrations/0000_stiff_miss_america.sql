CREATE TABLE `_archived_learning_categories` (
	`category_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `_archived_learning_categories_name_unique` ON `_archived_learning_categories` (`name`);--> statement-breakpoint
CREATE TABLE `_archived_learning_category_assignments` (
	`learning_id` text NOT NULL,
	`category_id` text NOT NULL,
	`assigned_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archived_category_pk` ON `_archived_learning_category_assignments` (`learning_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `_archived_learning_sources` (
	`learning_id` text NOT NULL,
	`conversation_uuid` text,
	`message_uuid` text
);
--> statement-breakpoint
CREATE TABLE `_archived_learnings` (
	`learning_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`embedding` blob
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`uuid` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`platform` text DEFAULT 'claude' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`embedding` blob
);
--> statement-breakpoint
CREATE INDEX `idx_conversations_created` ON `conversations` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_updated` ON `conversations` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_conversations_platform` ON `conversations` (`platform`);--> statement-breakpoint
CREATE TABLE `learnings` (
	`learning_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`context` text NOT NULL,
	`insight` text NOT NULL,
	`why` text NOT NULL,
	`implications` text NOT NULL,
	`tags` text NOT NULL,
	`abstraction` text NOT NULL,
	`understanding` text NOT NULL,
	`effort` text NOT NULL,
	`resonance` text NOT NULL,
	`learning_type` text,
	`source_credit` text,
	`conversation_uuid` text,
	`embedding` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_learnings_created` ON `learnings` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_learnings_type` ON `learnings` (`learning_type`);--> statement-breakpoint
CREATE INDEX `idx_learnings_conversation` ON `learnings` (`conversation_uuid`);--> statement-breakpoint
CREATE TABLE `message_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_uuid` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	`embedding` blob,
	FOREIGN KEY (`message_uuid`) REFERENCES `messages`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chunks_message` ON `message_chunks` (`message_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_chunks_unique` ON `message_chunks` (`message_uuid`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `messages` (
	`uuid` text PRIMARY KEY NOT NULL,
	`conversation_uuid` text NOT NULL,
	`conversation_index` integer NOT NULL,
	`sender` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`chunk_count` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`conversation_uuid`) REFERENCES `conversations`(`uuid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_uuid`);--> statement-breakpoint
CREATE INDEX `idx_messages_sender` ON `messages` (`sender`);--> statement-breakpoint
CREATE INDEX `idx_messages_created` ON `messages` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_index` ON `messages` (`conversation_uuid`,`conversation_index`);