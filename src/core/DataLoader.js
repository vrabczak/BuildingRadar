import { StorageManager } from './StorageManager.js';
import { FileProcessor } from './FileProcessor.js';
import { FileModalUI } from './FileModalUI.js';
import { DeviceUtils } from './DeviceUtils.js';
import { SpatialIndex } from './SpatialIndex.js';
import { StorageConfig } from './SettingsManager.js';

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
     * Restore buildings data from IndexedDB (spatial index format with lazy loading)
     */
    async restoreData() {
        try {
            console.log('Restoring spatial index from IndexedDB...');
            this.ui.showStatus('Loading saved data...', 'loading');

            const result = await this.storage.loadSpatialIndex();

            if (result) {
                // Create spatial index and deserialize (grid structure only)
                this.spatialIndex = new SpatialIndex();
                this.spatialIndex.deserialize(result.indexData);

                // Enable lazy loading with chunk loader
                this.spatialIndex.enableLazyLoading(async (chunkIds) => {
                    return await this.storage.loadChunks(chunkIds);
                });

                // Show stored data info
                const metadata = result.metadata;
                if (metadata) {
                    if (metadata.folderName) {
                        // Folder metadata
                        console.log(`📦 Stored folder: ${metadata.folderName} (${metadata.fileCount} files, ${(metadata.totalSize / 1024 / 1024).toFixed(1)}MB)`);
                    } else if (metadata.filename) {
                        // Legacy file metadata
                        console.log(`📦 Stored file: ${metadata.filename} (${(metadata.filesize / 1024 / 1024).toFixed(1)}MB)`);
                    }
                    console.log(`📅 Uploaded: ${new Date(metadata.uploadDate).toLocaleString()}`);
                    console.log(`🗺️ Spatial index: ${this.spatialIndex.grid.size} grid cells`);
                    console.log(`💾 Lazy loading: ${result.chunkCount} chunks available`);
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
        } catch (error) {
            console.error('Failed to restore spatial index:', error);
            // Clear corrupted data
            await this.storage.clearData();
        }
        return false;
    }

    /**
     * Handle file/folder selection and upload
     */
    async handleFileSelect(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        // Detect if this is a folder upload (multiple files) or single file
        const isFolder = files.length > 1 || (files[0] && files[0].webkitRelativePath);

        // Log selection event
        if (window.crashLogger) {
            window.crashLogger.logEvent('FILE_SELECT', {
                isFolder: isFolder,
                fileCount: files.length,
                firstFile: files[0]?.name
            });
        }

        // Clear any existing data before uploading new data
        const storedMetadata = await this.storage.getMetadata();
        if (storedMetadata) {
            console.log(`🗑️ Clearing old data: ${storedMetadata.folderName || storedMetadata.filename}`);
            await this.storage.clearData();
        }

        if (isFolder) {
            await this.handleFolderUpload(files);
        } else {
            await this.handleSingleFileUpload(files[0]);
        }
    }

    /**
     * Handle folder upload with multiple shapefiles
     */
    async handleFolderUpload(files) {
        const folderPath = files[0].webkitRelativePath;
        const folderName = folderPath ? folderPath.split('/')[0] : 'shapefiles';

        console.log(`📂 Uploading folder: ${folderName} with ${files.length} files`);
        this.ui.showStatus(`Loading folder with ${files.length} files...`, 'loading');

        // Calculate total size
        let totalSize = 0;
        for (const file of files) {
            totalSize += file.size;
        }
        const totalSizeMB = (totalSize / 1024 / 1024).toFixed(1);
        console.log(`Total folder size: ${totalSizeMB}MB`);

        // Create metadata for the folder
        this.currentFileMetadata = {
            folderName: folderName,
            fileCount: files.length,
            totalSize: totalSize,
            uploadDate: new Date().toISOString()
        };

        // Check memory before processing
        const memInfo = DeviceUtils.checkMemory();
        console.log('Memory before folder load:', memInfo);

        try {
            if (window.crashLogger) {
                window.crashLogger.logEvent('FOLDER_LOAD_START', {
                    fileCount: files.length,
                    totalSize: totalSize
                });
            }

            // Process all shapefiles in the folder incrementally
            const result = await this.fileProcessor.loadShapefilesFromFolder(files);

            if (window.crashLogger) {
                window.crashLogger.logEvent('FOLDER_LOAD_COMPLETE', {
                    featureCount: result.combinedGeoJSON.features?.length || 0,
                    shapefileCount: result.featuresByShapefile.length
                });
            }

            // Build spatial index directly (memory-efficient)
            this.ui.showStatus('Building spatial index...', 'loading');
            console.log('Building spatial index from features...');

            this.spatialIndex = new SpatialIndex();
            const geojson = this.fileProcessor.convertToGeoJSON(result.combinedGeoJSON);

            // Index features (this is fast and memory-efficient)
            this.spatialIndex.indexFeatures(geojson);
            const featureCount = this.spatialIndex.getFeatureCount();

            console.log(`Indexed ${featureCount} features from ${result.featuresByShapefile.length} shapefiles, memory:`, DeviceUtils.checkMemory());

            // Save spatial index to IndexedDB (chunked by shapefile for optimal spatial locality)
            this.ui.showStatus('Preparing to save...', 'loading');
            if (window.crashLogger) {
                window.crashLogger.logEvent('SAVING_SPATIAL_INDEX', {
                    featureCount,
                    shapefileCount: result.featuresByShapefile.length
                });
            }

            // Calculate chunk boundaries based on shapefile organization
            const chunkBoundaries = [];
            let currentIndex = 0;
            for (const sf of result.featuresByShapefile) {
                chunkBoundaries.push({
                    start: currentIndex,
                    end: currentIndex + sf.features.length,
                    shapefileName: sf.shapefileName
                });
                currentIndex += sf.features.length;
            }
            console.log(`🗂️ Chunk boundaries:`, chunkBoundaries.map(cb => `${cb.shapefileName}: [${cb.start}-${cb.end})`).join(', '));

            const indexData = this.spatialIndex.serialize(chunkBoundaries);

            // Create chunks based on shapefile boundaries (each shapefile = one chunk)
            const featureChunks = result.featuresByShapefile.map(sf => sf.features);
            console.log(`📦 Created ${featureChunks.length} chunks (one per shapefile)`);

            // Save with progress callback
            await this.storage.saveSpatialIndex(indexData, featureChunks, this.currentFileMetadata, (progress) => {
                // Update UI with progress
                if (progress.phase === 'init') {
                    this.ui.showStatus('Initializing storage...', 'loading');
                } else if (progress.phase === 'saving') {
                    const percent = Math.round((progress.current / progress.total) * 100);
                    this.ui.showStatus(`Saving chunk ${progress.current}/${progress.total} (${percent}%)...`, 'loading');
                } else if (progress.phase === 'finalizing') {
                    this.ui.showStatus('Finalizing save...', 'loading');
                }
            });

            // Enable lazy loading with chunk loader (needed for queries to work)
            this.spatialIndex.enableLazyLoading(async (chunkIds) => {
                return await this.storage.loadChunks(chunkIds);
            });

            this.ui.showStatus(`✓ Loaded ${featureCount} buildings successfully!`, 'success');

            setTimeout(() => {
                this.ui.hideModal();
                window.dispatchEvent(new CustomEvent('buildingsLoaded', {
                    detail: this.spatialIndex
                }));
            }, 1000);
        } catch (error) {
            console.error('Error loading folder:', error);

            // Log crash details
            if (window.crashLogger) {
                window.crashLogger.logCrash(
                    'FOLDER_LOAD_ERROR',
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
                errorMsg = 'Data too large for this device. Try a smaller dataset.';
            } else if (error.message.includes('No valid shapefiles')) {
                errorMsg = 'No valid shapefiles found in folder. Please select a folder with .shp files.';
            }

            this.ui.showStatus(`✗ Error: ${errorMsg}`, 'error');
        }
    }

    /**
     * Handle single file upload (legacy support)
     */
    async handleSingleFileUpload(file) {
        console.log(`📂 Uploading single file: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);

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

            // Save spatial index to IndexedDB (single file = one chunk)
            this.ui.showStatus('Preparing to save...', 'loading');
            if (window.crashLogger) {
                window.crashLogger.logEvent('SAVING_SPATIAL_INDEX', { featureCount });
            }

            // Treat single file as one chunk (entire file = one shapefile tile)
            const chunkBoundaries = [{
                start: 0,
                end: featureCount,
                shapefileName: file.name.replace(/\.[^/.]+$/, '') // Remove extension
            }];
            console.log(`🗂️ Single file chunk boundary: [0-${featureCount})`);

            const indexData = this.spatialIndex.serialize(chunkBoundaries);

            // Create single chunk with all features
            const featureChunks = [this.spatialIndex.allFeatures];
            console.log(`📦 Created 1 chunk (entire file)`);

            // Save with progress callback
            await this.storage.saveSpatialIndex(indexData, featureChunks, this.currentFileMetadata, (progress) => {
                // Update UI with progress
                if (progress.phase === 'init') {
                    this.ui.showStatus('Initializing storage...', 'loading');
                } else if (progress.phase === 'saving') {
                    this.ui.showStatus('Saving data...', 'loading');
                } else if (progress.phase === 'finalizing') {
                    this.ui.showStatus('Finalizing save...', 'loading');
                }
            });

            // Enable lazy loading with chunk loader (needed for queries to work)
            this.spatialIndex.enableLazyLoading(async (chunkIds) => {
                return await this.storage.loadChunks(chunkIds);
            });

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
