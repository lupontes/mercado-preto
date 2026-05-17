import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260517035504 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payout" ("id" text not null, "sellerId" text not null, "amount" numeric not null, "periodStart" timestamptz not null, "periodEnd" timestamptz not null, "status" text check ("status" in ('pending', 'processing', 'completed', 'failed')) not null default 'pending', "processedAt" timestamptz null, "notes" text null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payout_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payout_deleted_at" ON "payout" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payout" cascade;`);
  }

}
