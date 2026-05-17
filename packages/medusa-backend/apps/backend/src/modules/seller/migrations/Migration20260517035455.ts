import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260517035455 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "seller" add column if not exists "passwordHash" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "seller" drop column if exists "passwordHash";`);
  }

}
