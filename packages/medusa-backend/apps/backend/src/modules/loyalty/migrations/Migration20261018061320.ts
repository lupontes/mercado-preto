import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261018061320 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "loyalty_entry" drop constraint if exists "loyalty_entry_type_externalReference_unique";`);
    this.addSql(`create table if not exists "loyalty_code" ("id" text not null, "buyerDocument" text not null, "codeHash" text not null, "expiresAt" timestamptz not null, "attempts" integer not null default 0, "usedAt" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "loyalty_code_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_code_buyerDocument" ON "loyalty_code" ("buyerDocument") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_code_deleted_at" ON "loyalty_code" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "loyalty_entry" ("id" text not null, "buyerDocument" text not null, "type" text check ("type" in ('earn', 'reserve', 'redeem')) not null, "points" integer not null, "externalReference" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "loyalty_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_entry_buyerDocument" ON "loyalty_entry" ("buyerDocument") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_loyalty_entry_deleted_at" ON "loyalty_entry" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_loyalty_entry_type_externalReference_unique" ON "loyalty_entry" ("type", "externalReference") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "loyalty_code" cascade;`);

    this.addSql(`drop table if exists "loyalty_entry" cascade;`);
  }

}
