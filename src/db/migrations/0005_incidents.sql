CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"probe_id" text NOT NULL,
	"severity" "probe_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_probe_id_index" ON "incidents" USING btree ("probe_id") WHERE "incidents"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "incidents_started_at_index" ON "incidents" USING btree ("started_at" DESC NULLS LAST);