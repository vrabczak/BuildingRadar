/**
 * StorageManager - Handles IndexedDB operations via Web Worker to prevent UI blocking
 * Stores spatial index structure with chunked features for memory efficiency
 */
export class StorageManager {
    constructor() {
        this.storageKey = 'buildingRadarData';
        this.indexKey = 'spatialIndex';
        this.featuresPrefix = 'features_chunk_';
        this.dbName = 'BuildingRadarDB';
        this.dbVersion = 2; // Increment version for new schema
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
            const DB_VERSION = 2;
            const STORE_NAME = 'buildings';
            const STORAGE_KEY = 'buildingRadarData';
            const INDEX_KEY = 'spatialIndex';
            const FEATURES_PREFIX = 'features_chunk_';

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
                        // Migration: Clear old format data if upgrading
                        if (event.oldVersion < 2) {
                            console.log('Upgrading database schema to v2 (spatial index format)');
                        }
                    };
                });
            }

            function saveSpatialIndex(indexData, featureChunks, metadata = {}) {
                return new Promise(async (resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    
                    try {
                        // Clear old chunk data first
                        await clearFeatureChunks();
                        
                        const transaction = db.transaction([STORE_NAME], 'readwrite');
                        const store = transaction.objectStore(STORE_NAME);
                        
                        // Save index structure
                        const indexRecord = {
                            id: INDEX_KEY,
                            data: indexData,
                            metadata: metadata,
                            chunkCount: featureChunks.length,
                            timestamp: Date.now()
                        };
                        store.put(indexRecord);
                        
                        // Save feature chunks
                        for (let i = 0; i < featureChunks.length; i++) {
                            const chunkRecord = {
                                id: FEATURES_PREFIX + i,
                                data: featureChunks[i],
                                chunkIndex: i
                            };
                            store.put(chunkRecord);
                            
                            if (i % 10 === 0) {
                                postMessage({ 
                                    action: 'progress', 
                                    message: \`Saving chunk \${i + 1}/\${featureChunks.length}...\` 
                                });
                            }
                        }
                        
                        transaction.oncomplete = () => resolve();
                        transaction.onerror = () => reject(transaction.error);
                    } catch (error) {
                        reject(error);
                    }
                });
            }

            function loadSpatialIndex() {
                return new Promise(async (resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    
                    try {
                        const transaction = db.transaction([STORE_NAME], 'readonly');
                        const store = transaction.objectStore(STORE_NAME);
                        
                        // Load index structure only (without features for lazy loading)
                        const indexRequest = store.get(INDEX_KEY);
                        indexRequest.onsuccess = () => {
                            const indexRecord = indexRequest.result;
                            if (!indexRecord) {
                                resolve(null);
                                return;
                            }
                            
                            // Return index structure without features
                            resolve({
                                indexData: indexRecord.data,
                                metadata: indexRecord.metadata,
                                chunkCount: indexRecord.chunkCount || 0
                            });
                        };
                        indexRequest.onerror = () => reject(indexRequest.error);
                    } catch (error) {
                        reject(error);
                    }
                });
            }

            function loadChunks(chunkIds) {
                return new Promise(async (resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    
                    try {
                        const transaction = db.transaction([STORE_NAME], 'readonly');
                        const store = transaction.objectStore(STORE_NAME);
                        const chunks = [];
                        
                        for (const chunkId of chunkIds) {
                            const request = store.get(FEATURES_PREFIX + chunkId);
                            const chunk = await new Promise((res, rej) => {
                                request.onsuccess = () => res(request.result?.data);
                                request.onerror = () => rej(request.error);
                            });
                            
                            if (chunk) {
                                chunks.push({ id: chunkId, features: chunk });
                            }
                        }
                        
                        resolve(chunks);
                    } catch (error) {
                        reject(error);
                    }
                });
            }

            function clearFeatureChunks() {
                return new Promise((resolve, reject) => {
                    if (!db) { resolve(); return; }
                    
                    const transaction = db.transaction([STORE_NAME], 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    
                    // Get all keys and delete chunk keys
                    const getAllKeysRequest = store.getAllKeys();
                    getAllKeysRequest.onsuccess = () => {
                        const keys = getAllKeysRequest.result;
                        const chunkKeys = keys.filter(key => 
                            typeof key === 'string' && key.startsWith(FEATURES_PREFIX)
                        );
                        
                        chunkKeys.forEach(key => store.delete(key));
                        resolve();
                    };
                    getAllKeysRequest.onerror = () => reject(getAllKeysRequest.error);
                });
            }

            function getMetadata() {
                return new Promise((resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    const transaction = db.transaction([STORE_NAME], 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.get(INDEX_KEY);
                    request.onsuccess = () => resolve(request.result?.metadata || null);
                    request.onerror = () => reject(request.error);
                });
            }

            function clearData() {
                return new Promise(async (resolve, reject) => {
                    if (!db) { reject(new Error('DB not initialized')); return; }
                    
                    try {
                        const transaction = db.transaction([STORE_NAME], 'readwrite');
                        const store = transaction.objectStore(STORE_NAME);
                        
                        // Delete spatial index
                        store.delete(INDEX_KEY);
                        
                        // Delete all feature chunks
                        await clearFeatureChunks();
                        
                        transaction.oncomplete = () => resolve();
                        transaction.onerror = () => reject(transaction.error);
                    } catch (error) {
                        reject(error);
                    }
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
                        case 'saveSpatialIndex':
                            postMessage({ action: 'progress', id, message: 'Saving spatial index...' });
                            await saveSpatialIndex(payload.indexData, payload.featureChunks, payload.metadata);
                            result = { success: true };
                            break;
                        case 'loadSpatialIndex':
                            postMessage({ action: 'progress', id, message: 'Loading spatial index...' });
                            result = await loadSpatialIndex();
                            break;
                        case 'loadChunks':
                            result = await loadChunks(payload.chunkIds);
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
     * Save spatial index with chunked features (memory-efficient)
     */
    async saveSpatialIndex(indexData, featureChunks, metadata = {}) {
        try {
            const totalFeatures = featureChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            console.log(`Saving spatial index: ${featureChunks.length} chunks, ${totalFeatures} features`);
            const startTime = performance.now();

            const payload = {
                indexData: indexData,
                featureChunks: featureChunks,
                metadata: metadata
            };

            await this.sendToWorker('saveSpatialIndex', payload);

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`Spatial index saved in ${elapsed}s`);
            return true;
        } catch (error) {
            console.error('Failed to save spatial index:', error);
            return false;
        }
    }

    /**
     * Load spatial index (lazy mode - without features)
     */
    async loadSpatialIndex() {
        try {
            console.log('Loading spatial index structure from IndexedDB...');
            const startTime = performance.now();

            const result = await this.sendToWorker('loadSpatialIndex');

            if (result) {
                const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
                console.log(`Loaded spatial index in ${elapsed}s (${result.chunkCount} chunks available, lazy loading enabled)`);
            }

            return result;
        } catch (error) {
            console.error('Failed to load spatial index:', error);
            return null;
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