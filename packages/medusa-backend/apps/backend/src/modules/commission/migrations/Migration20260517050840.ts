import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260517050840 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "marketplace_config" ("id" text not null, "key" text not null, "value" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "marketplace_config_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_marketplace_config_deleted_at" ON "marketplace_config" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "marketplace_config" cascade;`);
  }

}
