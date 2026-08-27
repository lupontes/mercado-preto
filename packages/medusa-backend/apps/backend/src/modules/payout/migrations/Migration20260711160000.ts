import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260711160000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "payout" drop constraint if exists "payout_status_check";`);
    this.addSql(`alter table if exists "payout" add constraint "payout_status_check" check ("status" in ('pending', 'processing', 'completed', 'failed', 'cancelled'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "payout" drop constraint if exists "payout_status_check";`);
    this.addSql(`alter table if exists "payout" add constraint "payout_status_check" check ("status" in ('pending', 'processing', 'completed', 'failed'));`);
  }

}
