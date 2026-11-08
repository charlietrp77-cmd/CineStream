import { useState, useEffect } from 'react';
import { OfflineMediaItem } from '../types/api';

const DB_NAME = 'cinestream_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_media';

let globalOfflineItems: OfflineMediaItem[] = [];
let globalIsOfflineMode: boolean = !navigator.onLine;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function imageToBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return '';
  }
}

export function useOfflineStore() {
  const [offlineItems, setOfflineItems] = useState<OfflineMediaItem[]>(globalOfflineItems);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(globalIsOfflineMode);

  useEffect(() => {
    const handleUpdate = () => {
      setOfflineItems([...globalOfflineItems]);
      setIsOfflineMode(globalIsOfflineMode);
    };

    listeners.add(handleUpdate);
    loadItems();

    const handleOnline = () => checkNetworkHealth();
    const handleOffline = () => {
      globalIsOfflineMode = true;
      notify();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const interval = setInterval(checkNetworkHealth, 15000);

    return () => {
      listeners.delete(handleUpdate);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  const checkNetworkHealth = async () => {
    if (!navigator.onLine) {
      globalIsOfflineMode = true;
      notify();
      return;
    }

    try {
      const res = await fetch('/api/health', { method: 'GET', signal: AbortSignal.timeout(3000) });
      globalIsOfflineMode = !res.ok;
    } catch (_) {
      globalIsOfflineMode = true;
    }
    notify();
  };

  const loadItems = async (): Promise<OfflineMediaItem[]> => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      return new Promise((resolve) => {
        req.onsuccess = () => {
          globalOfflineItems = req.result || [];
          notify();
          resolve(globalOfflineItems);
        };
        req.onerror = () => resolve([]);
      });
    } catch (e) {
      console.error('Error loading offline media from IndexedDB:', e);
      return [];
    }
  };

  const saveItem = async (item: OfflineMediaItem): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(item);

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      const idx = globalOfflineItems.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        globalOfflineItems[idx] = item;
      } else {
        globalOfflineItems.push(item);
      }
      notify();
    } catch (e) {
      console.error('Failed to save offline item:', e);
    }
  };

  const removeItem = async (id: string): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      globalOfflineItems = globalOfflineItems.filter((i) => i.id !== id);
      notify();
    } catch (e) {
      console.error('Failed to remove offline item:', e);
    }
  };

  const toggleOfflineMode = () => {
    globalIsOfflineMode = !globalIsOfflineMode;
    notify();
  };

  return {
    offlineItems,
    isOfflineMode,
    toggleOfflineMode,
    checkNetworkHealth,
    loadItems,
    saveItem,
    removeItem,
  };
}

