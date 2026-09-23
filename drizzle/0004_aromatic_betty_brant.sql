ALTER TABLE "experiments" ADD COLUMN "evaluation" jsonb;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "evaluated_at" timestamp with time zone;