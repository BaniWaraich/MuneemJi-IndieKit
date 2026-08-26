CREATE TABLE "invoice_checklist_item_txs" (
	"item_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	CONSTRAINT "invoice_checklist_item_txs_pk" PRIMARY KEY("item_id","bank_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"payee_key" text NOT NULL,
	"display_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"period_label" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"document_id" uuid,
	"gmail_connection_id" uuid,
	"gmail_search_status" text DEFAULT 'not_eligible' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payee_clarifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"payee_key" text NOT NULL,
	"prompt_text" text NOT NULL,
	"sample_amounts_minor" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"occurrence_count" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payee_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_org_id" uuid NOT NULL,
	"payee_key" text NOT NULL,
	"display_name" text NOT NULL,
	"relationship" text NOT NULL,
	"invoice_policy" text NOT NULL,
	"source" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "gmail_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "gmail_address" text;--> statement-breakpoint
ALTER TABLE "invoice_checklist_item_txs" ADD CONSTRAINT "invoice_checklist_item_txs_item_id_invoice_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."invoice_checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checklist_item_txs" ADD CONSTRAINT "invoice_checklist_item_txs_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checklist_items" ADD CONSTRAINT "invoice_checklist_items_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checklist_items" ADD CONSTRAINT "invoice_checklist_items_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checklist_items" ADD CONSTRAINT "invoice_checklist_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_checklist_items" ADD CONSTRAINT "invoice_checklist_items_gmail_connection_id_gmail_connections_id_fk" FOREIGN KEY ("gmail_connection_id") REFERENCES "public"."gmail_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_clarifications" ADD CONSTRAINT "payee_clarifications_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_clarifications" ADD CONSTRAINT "payee_clarifications_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_memory" ADD CONSTRAINT "payee_memory_client_org_id_client_orgs_id_fk" FOREIGN KEY ("client_org_id") REFERENCES "public"."client_orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_checklist_items_statement_payee" ON "invoice_checklist_items" USING btree ("statement_id","payee_key");--> statement-breakpoint
CREATE INDEX "invoice_checklist_items_client_org_id_idx" ON "invoice_checklist_items" USING btree ("client_org_id");--> statement-breakpoint
CREATE INDEX "invoice_checklist_items_statement_id_idx" ON "invoice_checklist_items" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "invoice_checklist_items_status_idx" ON "invoice_checklist_items" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payee_clarifications_statement_payee" ON "payee_clarifications" USING btree ("statement_id","payee_key");--> statement-breakpoint
CREATE INDEX "payee_clarifications_client_org_id_idx" ON "payee_clarifications" USING btree ("client_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payee_memory_org_key" ON "payee_memory" USING btree ("client_org_id","payee_key");--> statement-breakpoint
CREATE INDEX "payee_memory_client_org_id_idx" ON "payee_memory" USING btree ("client_org_id");--> statement-breakpoint
CREATE INDEX "documents_gmail_connection_id_idx" ON "documents" USING btree ("gmail_connection_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_gmail_connection_id_gmail_connections_id_fk" FOREIGN KEY ("gmail_connection_id") REFERENCES "public"."gmail_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_checklist_item_txs_tx_idx" ON "invoice_checklist_item_txs" USING btree ("bank_transaction_id");