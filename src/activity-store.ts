export interface StoredActivity {
  id: string;
  name: string;
  startedAt: number;
  duration: number;
  blob: Blob;
}

const DATABASE_NAME = "fitfiles-training";
const STORE_NAME = "activities";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open activity storage."));
  });
}

export async function saveActivity(activity: StoredActivity): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(activity);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save activity."));
  });
  database.close();
}

export async function listActivities(): Promise<StoredActivity[]> {
  const database = await openDatabase();
  const activities = await new Promise<StoredActivity[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as StoredActivity[]);
    request.onerror = () => reject(request.error ?? new Error("Could not load activities."));
  });
  database.close();
  return activities.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteActivity(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not delete activity."));
  });
  database.close();
}
