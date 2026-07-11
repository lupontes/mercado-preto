import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "commission" add column if not exists "payoutId" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "commission" drop column if exists "payoutId";`);
  }

}
