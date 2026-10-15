import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261015120000 extends Migration {

  override async up(): Promise<void> {
    for (const column of ["addressPostalCode", "addressStreet", "addressNumber", "addressComplement", "addressDistrict", "addressCity", "addressState"]) {
      this.addSql(`alter table if exists "seller" add column if not exists "${column}" text null;`);
    }
  }

  override async down(): Promise<void> {
    for (const column of ["addressPostalCode", "addressStreet", "addressNumber", "addressComplement", "addressDistrict", "addressCity", "addressState"]) {
      this.addSql(`alter table if exists "seller" drop column if exists "${column}";`);
    }
  }

}
