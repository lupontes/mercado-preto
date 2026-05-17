import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260517033331 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "commission" ("id" text not null, "orderId" text not null, "sellerId" text not null, "grossAmount" numeric not null, "bankingFees" numeric not null, "netAmount" numeric not null, "commissionRate" integer not null, "commissionAmount" numeric not null, "sellerPayout" numeric not null, "status" text check ("status" in ('pending', 'paid')) not null default 'pending', "paidAt" timestamptz null, "raw_grossAmount" jsonb not null, "raw_bankingFees" jsonb not null, "raw_netAmount" jsonb not null, "raw_commissionAmount" jsonb not null, "raw_sellerPayout" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "commission_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_commission_deleted_at" ON "commission" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "commission" cascade;`);
  }

}
