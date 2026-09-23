CREATE TABLE "experiment_checkins" (
	"experiment_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"done" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_checkins_experiment_id_local_date_pk" PRIMARY KEY("experiment_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"intervention" text NOT NULL,
	"hypothesis" text NOT NULL,
	"rationale" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"conclusion" text,
	"created_by" text DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiment_checkins" ADD CONSTRAINT "experiment_checkins_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiments_user_idx" ON "experiments" USING btree ("user_id","start_date");