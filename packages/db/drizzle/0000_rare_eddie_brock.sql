CREATE TABLE `daily_metrics` (
	`local_date` text NOT NULL,
	`type_key` text NOT NULL,
	`value` real NOT NULL,
	`sample_count` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`local_date`, `type_key`),
	FOREIGN KEY (`type_key`) REFERENCES `event_types`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_metrics_type_idx` ON `daily_metrics` (`type_key`,`local_date`);--> statement-breakpoint
CREATE TABLE `event_types` (
	`key` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`description` text,
	`unit` text,
	`value_kind` text DEFAULT 'numeric' NOT NULL,
	`aggregation` text DEFAULT 'sum' NOT NULL,
	`polarity` integer DEFAULT 0 NOT NULL,
	`category` text,
	`color` text,
	`icon` text,
	`correlatable` integer DEFAULT true NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_types_category_idx` ON `event_types` (`category`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type_key` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_s` integer,
	`value` real,
	`value_text` text,
	`local_date` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`source_id` text,
	`dedupe_key` text NOT NULL,
	`ingested_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`type_key`) REFERENCES `event_types`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedupe_idx` ON `events` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `events_series_idx` ON `events` (`type_key`,`local_date`);--> statement-breakpoint
CREATE INDEX `events_time_idx` ON `events` (`started_at`);--> statement-breakpoint
CREATE TABLE `experiment_checkins` (
	`experiment_id` text NOT NULL,
	`local_date` text NOT NULL,
	`done` integer DEFAULT true NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`experiment_id`, `local_date`),
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`intervention` text NOT NULL,
	`hypothesis` text NOT NULL,
	`rationale` text,
	`sources` text DEFAULT '[]' NOT NULL,
	`target_metrics` text DEFAULT '[]' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`conclusion` text,
	`evaluation` text,
	`evaluated_at` integer,
	`created_by` text DEFAULT 'ai' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `experiments_start_idx` ON `experiments` (`start_date`);--> statement-breakpoint
CREATE TABLE `import_blobs` (
	`import_id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`content` text NOT NULL,
	`encoding` text DEFAULT 'utf8' NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text,
	`filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'detecting' NOT NULL,
	`detection` text,
	`mapping_spec_id` text,
	`match_kind` text,
	`stats` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mapping_spec_id`) REFERENCES `mapping_specs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `imports_created_idx` ON `imports` (`created_at`);--> statement-breakpoint
CREATE TABLE `mapping_specs` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`origin` text NOT NULL,
	`spec` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`times_used` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mapping_specs_key_idx` ON `mapping_specs` (`key`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`last_sync_at` integer,
	`last_sync_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spec_fingerprints` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`spec_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`spec_id`) REFERENCES `mapping_specs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_fingerprints_unique` ON `spec_fingerprints` (`fingerprint`);