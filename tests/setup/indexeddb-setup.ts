import {
  IDBFactory,
  IDBKeyRange,
  IDBDatabase,
  IDBObjectStore,
  IDBIndex,
  IDBCursor,
  IDBCursorWithValue,
  IDBTransaction,
  IDBRequest,
  IDBOpenDBRequest,
} from 'fake-indexeddb';
import { beforeEach } from 'vitest';

// Install all IndexedDB globals into the test environment.
// db.ts uses indexedDB, IDBKeyRange (via .only/.bound), and IDB* types directly.
// A fresh IDBFactory per test ensures no cross-test state.
function installFakeIDB() {
  const g = globalThis as Record<string, unknown>;
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;
  g.IDBDatabase = IDBDatabase;
  g.IDBObjectStore = IDBObjectStore;
  g.IDBIndex = IDBIndex;
  g.IDBCursor = IDBCursor;
  g.IDBCursorWithValue = IDBCursorWithValue;
  g.IDBTransaction = IDBTransaction;
  g.IDBRequest = IDBRequest;
  g.IDBOpenDBRequest = IDBOpenDBRequest;
}

// Install once at module load so globals are available at collection time
installFakeIDB();

// Reinstall a fresh IDBFactory before each test (new namespace = no cross-test state)
beforeEach(() => {
  installFakeIDB();
});
