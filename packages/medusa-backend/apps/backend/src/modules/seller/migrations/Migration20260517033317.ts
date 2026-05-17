import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260517033317 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "seller" ("id" text not null, "name" text not null, "ownerName" text not null, "email" text not null, "phone" text not null, "cpfCnpj" text not null, "bio" text null, "location" text null, "category" text null, "bankName" text null, "bankAgency" text null, "bankAccount" text null, "bankAccountType" text check ("bankAccountType" in ('checking', 'savings')) null, "pixKey" text null, "pixKeyType" text check ("pixKeyType" in ('cpf', 'cnpj', 'email', 'phone', 'random')) null, "status" text check ("status" in ('pending', 'approved', 'active', 'suspended')) not null default 'pending', "rejectionReason" text null, "mercadopagoUserId" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "seller_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_seller_deleted_at" ON "seller" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "seller" cascade;`);
  }

}
