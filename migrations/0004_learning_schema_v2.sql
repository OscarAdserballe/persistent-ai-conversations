-- Migration: Update learnings table from trigger/faq schema to blocks schema
-- NOTE: This uses table recreation because SQLite doesn't support DROP COLUMN with foreign keys

-- Step 1: Create new table with updated schema
CREATE TABLE `learnings_new` (
	`learning_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`problem_space` text NOT NULL,
	`insight` text NOT NULL,
	`blocks` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`embedding` blob NOT NULL,
	`created_at` integer NOT NULL
);

--> statement-breakpoint

-- Step 2: Transform and copy existing data
-- Maps: trigger -> problem_space, faq -> blocks (simplified conversion)
INSERT INTO `learnings_new` (
	`learning_id`,
	`title`,
	`problem_space`,
	`insight`,
	`blocks`,
	`source_type`,
	`source_id`,
	`embedding`,
	`created_at`
)
SELECT
	`learning_id`,
	`title`,
	COALESCE(`trigger`, 'Imported learning'),
	`insight`,
	-- Convert old why_points + faq to blocks format
	CASE
		WHEN `why_points` IS NOT NULL AND `faq` IS NOT NULL THEN
			json_array(
				json_object('blockType', 'qa', 'question', 'Key points', 'answer', COALESCE(`why_points`, '[]'))
			)
		ELSE '[]'
	END,
	'conversation',
	COALESCE(`conversation_uuid`, ''),
	`embedding`,
	`created_at`
FROM `learnings`;

--> statement-breakpoint

-- Step 3: Drop old table and rename new one
DROP TABLE `learnings`;

--> statement-breakpoint

ALTER TABLE `learnings_new` RENAME TO `learnings`;

--> statement-breakpoint

-- Step 4: Recreate indexes
CREATE INDEX `idx_learnings_created` ON `learnings` (`created_at`);

--> statement-breakpoint

CREATE INDEX `idx_learnings_source` ON `learnings` (`source_type`, `source_id`);

--> statement-breakpoint

-- Step 5: Create new learning_reviews table for flashcard ratings
CREATE TABLE `learning_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`learning_id` text NOT NULL,
	`block_index` integer,
	`rating` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	FOREIGN KEY (`learning_id`) REFERENCES `learnings`(`learning_id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint

CREATE INDEX `idx_reviews_learning` ON `learning_reviews` (`learning_id`);

--> statement-breakpoint

CREATE INDEX `idx_reviews_time` ON `learning_reviews` (`reviewed_at`);
