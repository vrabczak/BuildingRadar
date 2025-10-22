/**
 * StorageManagerWorker - Web Worker for IndexedDB operations
 * Handles all database operations in background thread to prevent UI blocking
 */

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

function initSave(indexData, metadata, totalChunks) {
    return new Promise(async (resolve, reject) => {
        if (!db) { reject(new Error('DB not initialized')); return; }

        try {
            console.log('🗑️ Clearing old chunk data...');
            // Step 1: Clear old chunks
            await new Promise((res, rej) => {
                const clearTx = db.transaction([STORE_NAME], 'readwrite');
                const clearStore = clearTx.objectStore(STORE_NAME);

                const getAllKeysRequest = clearStore.getAllKeys();
                getAllKeysRequest.onsuccess = () => {
                    const keys = getAllKeysRequest.result;
                    const chunkKeys = keys.filter(key =>
                        typeof key === 'string' && key.startsWith(FEATURES_PREFIX)
                    );
                    chunkKeys.forEach(key => clearStore.delete(key));
                };
                getAllKeysRequest.onerror = () => rej(getAllKeysRequest.error);

                clearTx.oncomplete = () => res();
                clearTx.onerror = () => rej(clearTx.error);
            });
            console.log('✅ Old data cleared');

            console.log('💾 Saving index structure...');
            // Step 2: Save index structure
            await new Promise((res, rej) => {
                const indexTx = db.transaction([STORE_NAME], 'readwrite');
                const indexStore = indexTx.objectStore(STORE_NAME);

                const indexRecord = {
                    id: INDEX_KEY,
                    data: indexData,
                    metadata: metadata,
                    chunkCount: totalChunks,
                    timestamp: Date.now()
                };
                indexStore.put(indexRecord);

                indexTx.oncomplete = () => res();
                indexTx.onerror = () => rej(indexTx.error);
            });
            console.log('✅ Index structure saved');

            resolve();
        } catch (error) {
            console.error('❌ Error in initSave:', error);
            reject(error);
        }
    });
}

function saveChunkBatch(startIndex, chunks) {
    return new Promise(async (resolve, reject) => {
        if (!db) { reject(new Error('DB not initialized')); return; }

        try {
            console.log(`📦 [Worker] Saving ${chunks.length} chunks starting at index ${startIndex}...`);

            // Save chunks in smaller sub-batches to avoid transaction timeouts
            const SUB_BATCH_SIZE = 10;
            for (let i = 0; i < chunks.length; i += SUB_BATCH_SIZE) {
                const subBatchEnd = Math.min(i + SUB_BATCH_SIZE, chunks.length);

                await new Promise((res, rej) => {
                    const tx = db.transaction([STORE_NAME], 'readwrite');
                    const store = tx.objectStore(STORE_NAME);

                    for (let j = i; j < subBatchEnd; j++) {
                        const chunkRecord = {
                            id: FEATURES_PREFIX + (startIndex + j),
                            data: chunks[j],
                            chunkIndex: startIndex + j
                        };
                        store.put(chunkRecord);
                    }

                    tx.oncomplete = () => res();
                    tx.onerror = () => rej(tx.error);
                });
            }

            console.log(`✅ [Worker] Saved chunks ${startIndex}-${startIndex + chunks.length - 1}`);
            resolve();
        } catch (error) {
            console.error('❌ [Worker] Error saving chunk batch:', error);
            reject(error);
        }
    });
}

function finalizeSave() {
    return new Promise((resolve) => {
        console.log('🏁 [Worker] Save operation finalized');
        resolve();
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

            console.log(`[Worker] Loading chunks: ${chunkIds.join(',')}`);

            for (const chunkId of chunkIds) {
                const key = FEATURES_PREFIX + chunkId;
                const request = store.get(key);
                const chunkRecord = await new Promise((res, rej) => {
                    request.onsuccess = () => res(request.result);
                    request.onerror = () => rej(request.error);
                });

                if (chunkRecord && chunkRecord.data) {
                    console.log(`[Worker] Chunk ${chunkId}: ${chunkRecord.data.length} features`);
                    chunks.push({ id: chunkId, features: chunkRecord.data });
                } else {
                    console.warn(`[Worker] Chunk ${chunkId} not found or empty! Key: ${key}`);
                }
            }

            console.log(`[Worker] Returning ${chunks.length} chunks with total features: ${chunks.reduce((sum, c) => sum + c.features.length, 0)}`);
            resolve(chunks);
        } catch (error) {
            console.error('[Worker] Error loading chunks:', error);
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
    return new Promise((resolve, reject) => {
        if (!db) { reject(new Error('DB not initialized')); return; }

        try {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            // Get all keys first
            const getAllKeysRequest = store.getAllKeys();
            getAllKeysRequest.onsuccess = () => {
                const keys = getAllKeysRequest.result;

                // Delete all keys (index + chunks)
                keys.forEach(key => store.delete(key));
            };
            getAllKeysRequest.onerror = () => reject(getAllKeysRequest.error);

            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        } catch (error) {
            reject(error);
        }
    });
}

// Message handler - processes messages from main thread
self.addEventListener('message', async (event) => {
    const { action, payload, id } = event.data;
    try {
        let result;
        switch (action) {
            case 'init':
                await initDB();
                result = { success: true };
                break;
            case 'initSave':
                await initSave(payload.indexData, payload.metadata, payload.totalChunks);
                result = { success: true };
                break;
            case 'saveChunkBatch':
                await saveChunkBatch(payload.startIndex, payload.chunks);
                result = { success: true };
                break;
            case 'finalizeSave':
                await finalizeSave();
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
                throw new Error(`Unknown action: ${action}`);
        }
        postMessage({ action: 'response', id, success: true, data: result });
    } catch (error) {
        postMessage({ action: 'response', id, success: false, error: error.message });
    }
});