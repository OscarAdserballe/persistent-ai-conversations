CREATE TABLE `pdf_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pdf_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`page_number` integer,
	`text` text NOT NULL,
	`char_count` integer NOT NULL,
	`embedding` blob,
	FOREIGN KEY (`pdf_id`) REFERENCES `pdf_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pdf_chunks_pdf` ON `pdf_chunks` (`pdf_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pdf_chunks_unique` ON `pdf_chunks` (`pdf_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `pdf_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`filepath` text NOT NULL,
	`title` text,
	`page_count` integer NOT NULL,
	`char_count` integer NOT NULL,
	`document_type` text DEFAULT 'other',
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pdf_filename` ON `pdf_documents` (`filename`);--> statement-breakpoint
CREATE INDEX `idx_pdf_created` ON `pdf_documents` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pdf_type` ON `pdf_documents` (`document_type`);--> statement-breakpoint
CREATE TABLE `topics` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`key_points` text NOT NULL,
	`source_passages` text,
	`pdf_id` text NOT NULL,
	`parent_topic_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`embedding` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pdf_id`) REFERENCES `pdf_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_topics_pdf` ON `topics` (`pdf_id`);--> statement-breakpoint
CREATE INDEX `idx_topics_parent` ON `topics` (`parent_topic_id`);--> statement-breakpoint
CREATE INDEX `idx_topics_created` ON `topics` (`created_at`);