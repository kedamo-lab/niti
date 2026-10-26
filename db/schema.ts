import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const nitiRooms = sqliteTable('niti_rooms', {
  id: text('id').primaryKey(),
  masterHash: text('master_hash').notNull(),
  stateJson: text('state_json').notNull(),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
