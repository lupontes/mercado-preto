import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260829223000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "checkout_snapshot" ("id" text not null, "externalReference" text not null, "payload" jsonb not null, "preferenceId" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "checkout_snapshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_snapshot_deleted_at" ON "checkout_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_checkout_snapshot_external_reference_unique" ON "checkout_snapshot" ("externalReference") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "checkout_snapshot" cascade;`);
  }

}
