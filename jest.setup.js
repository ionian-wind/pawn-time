import { configureDatabasePath, closeDatabase, getDatabase } from './src/db/database.js';

beforeEach(() => {
  closeDatabase();
  configureDatabasePath(':memory:');
  getDatabase();
});

afterAll(() => {
  closeDatabase();
});
