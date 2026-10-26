CREATE TABLE `niti_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`master_hash` text NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
