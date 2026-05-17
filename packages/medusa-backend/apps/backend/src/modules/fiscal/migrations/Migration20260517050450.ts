import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260517050450 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "nf_document" ("id" text not null, "orderId" text not null, "sellerId" text not null, "type" text check ("type" in ('nfe', 'nfse')) not null default 'nfe', "status" text check ("status" in ('pending', 'processing', 'issued', 'cancelled', 'error')) not null default 'pending', "focusNfeRef" text null, "focusNfeId" text null, "xmlUrl" text null, "pdfUrl" text null, "series" text null, "number" text null, "issuedAt" timestamptz null, "errorMessage" text null, "amountCents" integer not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "nf_document_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_nf_document_deleted_at" ON "nf_document" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "nf_document" cascade;`);
  }

}
