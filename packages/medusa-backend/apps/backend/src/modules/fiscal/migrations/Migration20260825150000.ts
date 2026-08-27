import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260825150000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "nf_document" add column if not exists "ncmFallbackUsed" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "nf_document" drop column if exists "ncmFallbackUsed";`);
  }

}
