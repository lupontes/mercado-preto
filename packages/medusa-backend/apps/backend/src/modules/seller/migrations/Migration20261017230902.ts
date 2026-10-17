import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017230902 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "seller_password_token" drop constraint if exists "seller_password_token_tokenHash_unique";`);
    this.addSql(`create table if not exists "seller_password_token" ("id" text not null, "sellerId" text not null, "tokenHash" text not null, "expiresAt" timestamptz not null, "usedAt" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "seller_password_token_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_seller_password_token_tokenHash_unique" ON "seller_password_token" ("tokenHash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_seller_password_token_deleted_at" ON "seller_password_token" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "seller_password_token" cascade;`);
  }

}
