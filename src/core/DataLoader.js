import { StorageManager } from './StorageManager.js';
import { FileProcessor } from './FileProcessor.js';
import { FileModalUI } from './FileModalUI.js';
import { DeviceUtils } from './DeviceUtils.js';
import { SpatialIndex } from './SpatialIndex.js';

/**
 * DataLoader - Orchestrates file loading, storage, and UI for shapefile data
 * Coordinates between StorageManager, FileProcessor, and FileModalUI
 * Uses spatial index for memory-efficient storage and loading
 */
export class DataLoader {
    constructor() {
        this.spatialIndex = null;
        this.currentFileMetadata = null;

        // Initialize sub-components
        this.storage = new StorageManager();
        this.fileProcessor = new FileProcessor((msg, type) => this.ui.showStatus(msg, type));
        this.ui = new FileModalUI();

        // Initialize storage and UI
        this.initialize();

        // Expose methods to window for console access
        window.dataLoader = this;
    }

    /**
     * Initialize storage, worker, and UI
     */
    async initialize() {
        try {
            // Initialize storage worker and database
            this.storage.initWorker();
            await this.storage.initDB();

            // Setup UI event listeners
            this.ui.setupEventListeners({
                onRestore: () => this.restoreData(),
                onUploadNew: () => this.ui.showUploadView(),
                onBack: () => this.ui.showChoiceView(),
                onFileSelect: (e) => this.handleFileSelect(e)
            });

            // Update modal UI with stored metadata
            console.log('Calling updateModalUI...');
            const metadata = await this.storage.getMetadata();
            await this.ui.updateUI(metadata);
        } catch (error) {
            console.error('Error during initialization:', error);
            // Show error and allow upload anyway
            this.ui.setLoading(false);
            this.ui.showChoiceView();
        }
    }

    /**
     * Restore buildings data from IndexedDB (spatial index format)
     */
    async restoreData() {
        try {
            console.log('Restoring spatial index from IndexedDB...');
            this.ui.showStatus('Loading saved data...', 'loading');

            const result = await this.storage.loadSpatialIndex();

            if (result) {
                // Create spatial index and deserialize
                this.spatialIndex = new SpatialIndex();
                this.spatialIndex.deserialize(result.indexData);
                this.spatialIndex.loadFeatureChunks(result.featureChunks);

                const featureCount = this.spatialIndex.getFeatureCount();
                if (featureCount > 0) {
                    // Show stored data info
                    const metadata = result.metadata;
                    if (metadata) {
                        console.log(`📦 Stored file: ${metadata.filename} (${(metadata.filesize / 1024 / 1024).toFixed(1)}MB)`);
                        console.log(`📅 Uploaded: ${new Date(metadata.uploadDate).toLocaleString()}`);
                        console.log(`🗺️ Spatial index: ${this.spatialIndex.grid.size} grid cells`);
                    }

                    // Hide modal since we have data
                    this.ui.hideModal();
                    // Dispatch event with spatial index
                    setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('buildingsLoaded', {
                            detail: this.spatialIndex
                        }));
                    }, 100);
                    return true;
                }
            }
        } catch (error) {
            console.error('Failed to restore spatial index:', error);
            // Clear corrupted data
            await this.storage.clearData();
        }
        return false;
    }

    /**
     * Handle file selection and upload
     */
    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Log file selection event
        if (window.crashLogger) {
            window.crashLogger.logEvent('FILE_SELECT', {
                name: file.name,
                size: file.size,
                type: file.type
            });
        }

        // Clear any existing data before uploading new file
        const storedMetadata = await this.storage.getMetadata();
        if (storedMetadata) {
            console.log(`🗑️ Clearing old data: ${storedMetadata.filename} (${(storedMetadata.filesize / 1024 / 1024).toFixed(1)}MB)`);
            await this.storage.clearData();
        }
        console.log(`📂 Uploading new file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

        // Store file metadata for saving later
        this.currentFileMetadata = this.fileProcessor.createMetadata(file);

        // Show processing status for large files
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);

        // Check memory before processing
        const memInfo = DeviceUtils.checkMemory();
        console.log('Memory before file load:', memInfo);

        // Warn on mobile if file is very large
        if (DeviceUtils.isMobileDevice() && file.size > 30 * 1024 * 1024) {
            console.warn(`⚠️ Large file (${sizeMB}MB) on mobile device - may cause crash`);
            this.ui.showStatus(`⚠️ Large file (${sizeMB}MB) - processing slowly to avoid crash...`, 'loading');
        } else if (file.size > 50 * 1024 * 1024) {
            this.ui.showStatus(`Loading ${sizeMB}MB file, please wait...`, 'loading');
        } else {
            this.ui.showStatus('Reading file...', 'loading');
        }

        try {
            if (window.crashLogger) {
                window.crashLogger.logEvent('FILE_LOAD_START', { size: file.size });
            }

            const data = await this.fileProcessor.loadShapefile(file);

            if (window.crashLogger) {
                window.crashLogger.logEvent('FILE_LOAD_COMPLETE');
            }

            // Build spatial index directly (memory-efficient)
            this.ui.showStatus('Building spatial index...', 'loading');
            console.log('Building spatial index from features...');

            this.spatialIndex = new SpatialIndex();
            const geojson = this.fileProcessor.convertToGeoJSON(data);

            // Index features (this is fast and memory-efficient)
            this.spatialIndex.indexFeatures(geojson);
            const featureCount = this.spatialIndex.getFeatureCount();

            console.log(`Indexed ${featureCount} features, memory:`, DeviceUtils.checkMemory());

            // Save spatial index to IndexedDB (chunked for memory efficiency)
            this.ui.showStatus('Saving to storage...', 'loading');
            if (window.crashLogger) {
                window.crashLogger.logEvent('SAVING_SPATIAL_INDEX', { featureCount });
            }

            const indexData = this.spatialIndex.serialize();
            const featureChunks = this.spatialIndex.serializeFeatures(10000); // 10k features per chunk

            await this.storage.saveSpatialIndex(indexData, featureChunks, this.currentFileMetadata);

            this.ui.showStatus(`✓ Loaded ${featureCount} buildings successfully!`, 'success');

            setTimeout(() => {
                this.ui.hideModal();
                window.dispatchEvent(new CustomEvent('buildingsLoaded', {
                    detail: this.spatialIndex
                }));
            }, 1000);
        } catch (error) {
            console.error('Error loading shapefile:', error);

            // Log crash details
            if (window.crashLogger) {
                window.crashLogger.logCrash(
                    'FILE_LOAD_ERROR',
                    error.message,
                    null,
                    null,
                    null,
                    error.stack
                );
            }

            // Show user-friendly error
            let errorMsg = error.message;
            if (error.message.includes('memory') || error.name === 'RangeError') {
                errorMsg = 'File too large for this device. Try a smaller dataset.';
            } else if (error.message.includes('parse')) {
                errorMsg = 'Invalid shapefile format. Please check the file.';
            }

            this.ui.showStatus(`✗ Error: ${errorMsg}`, 'error');
        }
    }

    /**
     * Get spatial index
     */
    getSpatialIndex() {
        return this.spatialIndex;
    }

    /**
     * Get metadata about stored data (for console debugging)
     */
    async getStoredMetadata() {
        return await this.storage.getMetadata();
    }

    /**
     * Check if stored data is available and get info (for console debugging)
     */
    async getDataInfo() {
        const info = await this.storage.getDataInfo();
        if (info.exists) {
            info.featureCount = this.spatialIndex?.getFeatureCount() || 0;
            if (this.spatialIndex) {
                const metadata = this.spatialIndex.getMetadata();
                info.gridCells = metadata.gridCells;
                info.cellSize = metadata.cellSize;
            }
        }
        return info;
    }

    /**
     * Clear stored buildings data (for console debugging)
     */
    async clearStoredData() {
        const result = await this.storage.clearData();
        if (result) {
            this.spatialIndex = null;
        }
        return result;
    }
}
