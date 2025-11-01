import { StorageConfig } from './SettingsManager.js';

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
        // Load worker from external file for better code maintainability
        this.worker = new Worker(new URL('./StorageManagerWorker.js', import.meta.url));

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
    }

    /**
     * Save spatial index with incremental chunk streaming (memory-efficient)
     * Streams chunks to worker in small batches to avoid postMessage memory spike
     * @param {Function} progressCallback - Optional callback for progress updates
     */
    async saveSpatialIndex(indexData, featureChunks, metadata = {}, progressCallback = null) {
        try {
            const totalFeatures = featureChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            console.log(`💾 Starting incremental save: ${featureChunks.length} chunks, ${totalFeatures} features`);
            const startTime = performance.now();

            // Step 1: Initialize save (clear old data + save index structure)
            console.log('📋 Step 1/3: Initializing save (clearing old data + saving index)...');
            if (progressCallback) {
                progressCallback({ phase: 'init', total: featureChunks.length });
            }
            await this.sendToWorker('initSave', {
                indexData: indexData,
                metadata: metadata,
                totalChunks: featureChunks.length
            });
            console.log('✅ Save initialized');

            // Step 2: Save chunks one by one with detailed logging
            console.log(`📦 Step 2/3: Saving ${featureChunks.length} chunks one by one...`);

            for (let i = 0; i < featureChunks.length; i++) {
                const chunk = featureChunks[i];
                const chunkBoundary = indexData.chunkBoundaries ? indexData.chunkBoundaries[i] : null;

                // Log chunk metadata
                const chunkInfo = {
                    id: i,
                    featureCount: chunk.length,
                    shapefileName: chunkBoundary?.shapefileName || 'unknown',
                    indexRange: chunkBoundary ? `[${chunkBoundary.start}-${chunkBoundary.end})` : 'unknown'
                };

                console.log(`  📦 Saving chunk ${i}/${featureChunks.length}: ${chunkInfo.shapefileName}, ${chunkInfo.featureCount} features, range ${chunkInfo.indexRange}`);

                // Update progress
                if (progressCallback) {
                    progressCallback({
                        phase: 'saving',
                        current: i + 1,
                        total: featureChunks.length,
                        chunkName: chunkInfo.shapefileName
                    });
                }

                await this.sendToWorker('saveChunkBatch', {
                    startIndex: i,
                    chunks: [chunk]
                });

                console.log(`  ✅ Chunk ${i} saved (${i + 1}/${featureChunks.length})`);
            }

            // Step 3: Finalize
            console.log('🏁 Step 3/3: Finalizing save...');
            if (progressCallback) {
                progressCallback({ phase: 'finalizing' });
            }
            await this.sendToWorker('finalizeSave');

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`✅ Spatial index saved successfully in ${elapsed}s`);
            return true;
        } catch (error) {
            console.error('❌ Failed to save spatial index:', error);
            console.error('Error stack:', error.stack);
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
     * Load specific feature chunks by ID
     * @param {Array<number>} chunkIds - Array of chunk IDs to load
     * @returns {Promise<Array>} Array of loaded chunks
     */
    async loadChunks(chunkIds) {
        try {
            const result = await this.sendToWorker('loadChunks', { chunkIds });
            return result;
        } catch (error) {
            console.error('Failed to load chunks:', error);
            return [];
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