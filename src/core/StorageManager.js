/**
 * StorageManager - Handles IndexedDB operations via Web Worker to prevent UI blocking
 */
export class StorageManager {
    constructor() {
        this.storageKey = 'buildingRadarData';
        this.dbName = 'BuildingRadarDB';
        this.dbVersion = 1;
        this.messageId = 0;
        this.pendingMessages = new Map();
        this.worker = null;
    }

    /**
     * Initialize Web Worker for background IndexedDB operations
     */
    initWorker() {
        // Create worker from inline code to avoid separate file
        const workerCode = `
            let db = null;
            const DB_NAME = 'BuildingRadarDB';
            const DB_VERSION = 1;
            const STORE_NAME = 'buildings';
            const STORAGE_KEY = 'buildingRadarData';

            function initDB() {
                return new Promise((resolve, reject) => {
                    const request = indexedDB.open(DB_NAME, DB_VERSION);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        db = request.result;
                        resolve(db);
                    };
                    request.onupgradeneeded = (event) => {
                        const database = event.target.result;
                        if (!database.objectStoreNames.contains(STORE_NAME)) {
                            database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                        }
                    };
                });
            }

            function getData() {
                return new Promise((resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    const transaction = db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.get(STORAGE_KEY);
                    request.onsuccess = () => resolve(request.result?.data);
                    request.onerror = () => reject(request.error);
                });
            }

            function saveData(data, metadata = {}) {
                return new Promise((resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    const transaction = db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const record = { 
                        id: STORAGE_KEY, 
                        data: data, 
                        metadata: metadata,
                        timestamp: Date.now() 
                    };
                    const request = store.put(record);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            }

            function getMetadata() {
                return new Promise((resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    const transaction = db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.get(STORAGE_KEY);
                    request.onsuccess = () => resolve(request.result?.metadata || null);
                    request.onerror = () => reject(request.error);
                });
            }

            function clearData() {
                return new Promise((resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    const transaction = db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.delete(STORAGE_KEY);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            }

            self.addEventListener('message', async (event) => {
                const { action, payload, id } = event.data;
                try {
                    let result;
                    switch (action) {
                        case 'init':
                            await initDB();
                            result = { success: true };
                            break;
                        case 'get':
                            postMessage({ action: 'progress', id, message: 'Loading from IndexedDB...' });
                            result = await getData();
                            break;
                        case 'save':
                            const count = payload?.data?.features?.length || 0;
                            postMessage({ action: 'progress', id, message: \`Saving \${count} features...\` });
                            await saveData(payload.data, payload.metadata);
                            result = { success: true };
                            break;
                        case 'getMetadata':
                            result = await getMetadata();
                            break;
                        case 'clear':
                            await clearData();
                            result = { success: true };
                            break;
                        default:
                            throw new Error('Unknown action: ' + action);
                    }
                    postMessage({ action: 'response', id, success: true, data: result });
                } catch (error) {
                    postMessage({ action: 'response', id, success: false, error: error.message });
                }
            });
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        this.worker = new Worker(URL.createObjectURL(blob));

        // Handle worker messages
        this.worker.addEventListener('message', (event) => {
            const { action, id, success, data, error, message } = event.data;

            if (action === 'progress') {
                console.log('[Worker Progress]', message);
                return;
            }

            if (action === 'response') {
                const pending = this.pendingMessages.get(id);
                if (pending) {
                    this.pendingMessages.delete(id);
                    if (success) {
                        pending.resolve(data);
                    } else {
                        pending.reject(new Error(error));
                    }
                }
            }
        });

        console.log('Web Worker initialized for IndexedDB operations');
    }

    /**
     * Send message to worker and wait for response
     */
    sendToWorker(action, payload = null) {
        return new Promise((resolve, reject) => {
            const id = this.messageId++;
            this.pendingMessages.set(id, { resolve, reject });
            this.worker.postMessage({ action, payload, id });
        });
    }

    /**
     * Initialize IndexedDB via Web Worker
     */
    async initDB() {
        try {
            await this.sendToWorker('init');
            console.log('IndexedDB initialized via Web Worker');
            return true;
        } catch (error) {
            console.error('Failed to initialize IndexedDB:', error);
            throw error;
        }
    }

    /**
     * Get data from IndexedDB
     */
    async getData() {
        try {
            console.log('Loading data from IndexedDB (via Web Worker)...');
            const startTime = performance.now();
            const data = await this.sendToWorker('get');
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

            if (data) {
                const featureCount = data?.features?.length || 0;
                if (featureCount > 0) {
                    console.log(`Loaded ${featureCount} features from storage in ${elapsed}s`);
                }
            }

            return data;
        } catch (error) {
            console.error('Failed to get data:', error);
            throw error;
        }
    }

    /**
     * Save data to IndexedDB via Web Worker (non-blocking)
     */
    async saveData(data, metadata = {}) {
        try {
            const featureCount = data?.features?.length || 0;
            if (featureCount === 0) {
                console.warn('No features to save');
                return false;
            }

            console.log(`Saving ${featureCount} features to IndexedDB via Web Worker...`);
            const startTime = performance.now();

            const payload = {
                data: data,
                metadata: metadata
            };

            await this.sendToWorker('save', payload);

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`Data saved successfully in ${elapsed}s (${featureCount} features)`);
            return true;
        } catch (error) {
            console.error('Failed to save data:', error);

            // Handle quota errors
            if (error.message && error.message.includes('quota')) {
                console.warn('Storage quota exceeded. Try clearing old data or using a smaller dataset.');
                await this.clearData();
            }

            return false;
        }
    }

    /**
     * Get metadata about stored data
     */
    async getMetadata() {
        try {
            const metadata = await this.sendToWorker('getMetadata');
            return metadata;
        } catch (error) {
            console.error('Failed to get metadata:', error);
            return null;
        }
    }

    /**
     * Clear stored data from IndexedDB via Web Worker
     */
    async clearData() {
        try {
            await this.sendToWorker('clear');
            console.log('Data cleared from storage');
            return true;
        } catch (error) {
            console.error('Failed to clear data:', error);
            return false;
        }
    }

    /**
     * Check if stored data is available and get info
     */
    async getDataInfo() {
        const metadata = await this.getMetadata();
        if (metadata) {
            return {
                exists: true,
                filename: metadata.filename,
                filesize: metadata.filesize,
                uploadDate: metadata.uploadDate
            };
        }
        return { exists: false };
    }
}