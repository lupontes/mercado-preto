import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260904120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "channel_listing" ("id" text not null, "productId" text not null, "sellerId" text not null, "channel" text check ("channel" in ('mercado_livre')) not null, "externalItemId" text null, "externalCategoryId" text null, "saleFeePercent" real null, "saleFeeFixed" real null, "status" text check ("status" in ('draft', 'published', 'paused', 'error')) not null default 'draft', "lastError" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "channel_listing_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_listing_deleted_at" ON "channel_listing" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_channel_listing_external_item_id_unique" ON "channel_listing" ("externalItemId") WHERE "externalItemId" IS NOT NULL;`);

    this.addSql(`create table if not exists "channel_credential" ("id" text not null, "channel" text check ("channel" in ('mercado_livre')) not null, "accessToken" text not null, "refreshToken" text not null, "expiresAt" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "channel_credential_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_channel_credential_deleted_at" ON "channel_credential" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_channel_credential_channel_unique" ON "channel_credential" ("channel") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "channel_listing" cascade;`);
    this.addSql(`drop table if exists "channel_credential" cascade;`);
  }

}
