import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261017120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "checkout_snapshot" add column if not exists "status" text null;`);
    this.addSql(`alter table if exists "checkout_snapshot" add column if not exists "paymentId" text null;`);
    this.addSql(`alter table if exists "checkout_snapshot" add column if not exists "ordersCreatedAt" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "checkout_snapshot" drop column if exists "status";`);
    this.addSql(`alter table if exists "checkout_snapshot" drop column if exists "paymentId";`);
    this.addSql(`alter table if exists "checkout_snapshot" drop column if exists "ordersCreatedAt";`);
  }

}
