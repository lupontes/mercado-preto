import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261018063315 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "commission" add column if not exists "loyaltyDiscount" numeric not null default 0, add column if not exists "raw_loyaltyDiscount" jsonb not null default '{"value":"0","precision":20}';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "commission" drop column if exists "loyaltyDiscount", drop column if exists "raw_loyaltyDiscount";`);
  }

}
