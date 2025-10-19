/**
 * DataLoader - Handles loading and parsing of shapefile data with progress tracking
 * Uses Web Worker for IndexedDB operations to prevent UI blocking
 */
export class DataLoader {
    constructor() {
        this.buildingsData = null;
        this.fileInput = document.getElementById('shapefileInput');
        this.fileStatus = document.getElementById('fileStatus');
        this.modal = document.getElementById('fileInputModal');

        // New UI elements
        this.choiceView = document.getElementById('choiceView');
        this.uploadView = document.getElementById('uploadView');
        this.modalLoading = document.getElementById('modalLoading');
        this.choiceContent = document.getElementById('choiceContent');
        this.restoreDataBtn = document.getElementById('restoreDataBtn');
        this.uploadNewBtn = document.getElementById('uploadNewBtn');
        this.backToChoiceBtn = document.getElementById('backToChoiceBtn');
        this.savedDataInfo = document.getElementById('savedDataInfo');
        this.uploadWarning = document.getElementById('uploadWarning');

        this.storageKey = 'buildingRadarData';
        this.dbName = 'BuildingRadarDB';
        this.dbVersion = 1;
        this.maxFileSizeMobile = 50 * 1024 * 1024; // 50MB limit for mobile devices
        this.messageId = 0;
        this.pendingMessages = new Map();

        console.log('DataLoader elements:', {
            fileInput: !!this.fileInput,
            choiceView: !!this.choiceView,
            uploadView: !!this.uploadView
        });

        this.setupEventListeners();
        this.initWorker();
        this.initDB().then(() => {
            console.log('Calling updateModalUI...');
            return this.updateModalUI();
        }).catch(error => {
            console.error('Error during initialization:', error);
            // Show error and allow upload anyway
            if (this.modalLoading) {
                this.modalLoading.style.display = 'none';
            }
            if (this.choiceContent) {
                this.choiceContent.style.display = 'block';
            }
            this.showChoiceView();
        });

        // Expose methods to window for console access
        window.dataLoader = this;
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

    setupEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Restore saved data button
        if (this.restoreDataBtn) {
            this.restoreDataBtn.addEventListener('click', async () => {
                console.log('📦 User chose to restore saved data');
                await this.restoreData();
            });
        }

        // Upload new file button
        if (this.uploadNewBtn) {
            this.uploadNewBtn.addEventListener('click', () => {
                console.log('📁 User chose to upload new file');
                this.showUploadView();
            });
        }

        // Back to choice button
        if (this.backToChoiceBtn) {
            this.backToChoiceBtn.addEventListener('click', () => {
                this.showChoiceView();
            });
        }
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
     * Restore buildings data from IndexedDB via Web Worker (non-blocking)
     */
    async restoreData() {
        try {
            console.log('Restoring buildings data from IndexedDB (via Web Worker)...');
            this.showStatus('Loading saved data...', 'loading');

            const startTime = performance.now();
            const data = await this.sendToWorker('get');
            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

            if (data) {
                this.buildingsData = data;
                const featureCount = this.buildingsData?.features?.length || 0;
                if (featureCount > 0) {
                    console.log(`Restored ${featureCount} buildings from storage in ${elapsed}s`);

                    // Show stored data info
                    const metadata = await this.getStoredMetadata();
                    if (metadata) {
                        console.log(`📦 Stored file: ${metadata.filename} (${(metadata.filesize / 1024 / 1024).toFixed(1)}MB)`);
                        console.log(`📅 Uploaded: ${new Date(metadata.uploadDate).toLocaleString()}`);
                    }

                    // Hide modal since we have data
                    this.hideModal();
                    // Dispatch event so app can initialize
                    setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('buildingsLoaded', {
                            detail: this.buildingsData
                        }));
                    }, 100);
                    return true;
                }
            }
        } catch (error) {
            console.error('Failed to restore buildings data:', error);
            // Clear corrupted data
            await this.clearStoredData();
        }
        return false;
    }

    /**
     * Update modal UI based on whether saved data exists
     */
    async updateModalUI() {
        try {
            console.log('updateModalUI started');
            const metadata = await this.getStoredMetadata();
            console.log('Metadata retrieved:', metadata ? 'exists' : 'none');

            if (metadata && this.restoreDataBtn && this.savedDataInfo) {
                // Show restore button if data exists
                this.restoreDataBtn.style.display = 'flex';

                // Update subtitle with file info
                const sizeMB = (metadata.filesize / 1024 / 1024).toFixed(1);
                const date = new Date(metadata.uploadDate).toLocaleDateString();
                this.savedDataInfo.textContent = `${metadata.filename} (${sizeMB}MB) - ${date}`;

                // Show warning in upload view
                if (this.uploadWarning) {
                    this.uploadWarning.style.display = 'block';
                }
            } else {
                // Hide restore button if no data
                if (this.restoreDataBtn) {
                    this.restoreDataBtn.style.display = 'none';
                }

                // Hide warning in upload view
                if (this.uploadWarning) {
                    this.uploadWarning.style.display = 'none';
                }
            }

            // Hide loading indicator and show choice content
            console.log('Hiding loading indicator');
            if (this.modalLoading) {
                this.modalLoading.style.display = 'none';
            }
            if (this.choiceContent) {
                this.choiceContent.style.display = 'block';
            }

            // Always start with choice view
            this.showChoiceView();
            console.log('updateModalUI completed');
        } catch (error) {
            console.error('Error in updateModalUI:', error);
            // Fallback: show UI anyway
            if (this.modalLoading) {
                this.modalLoading.style.display = 'none';
            }
            if (this.choiceContent) {
                this.choiceContent.style.display = 'block';
            }
            this.showChoiceView();
        }
    }

    /**
     * Show the choice view (restore or upload)
     */
    showChoiceView() {
        if (this.choiceView) {
            this.choiceView.style.display = 'block';
        }
        if (this.uploadView) {
            this.uploadView.style.display = 'none';
        }
        // Clear file input
        if (this.fileInput) {
            this.fileInput.value = '';
        }
        this.showStatus('', '');
    }

    /**
     * Show the upload view
     */
    showUploadView() {
        if (this.choiceView) {
            this.choiceView.style.display = 'none';
        }
        if (this.uploadView) {
            this.uploadView.style.display = 'block';
        }
        this.showStatus('', '');
    }

    /**
     * Save buildings data to IndexedDB via Web Worker (non-blocking)
     */
    async saveData(data) {
        try {
            const featureCount = data?.features?.length || 0;
            if (featureCount === 0) {
                console.warn('No features to save');
                return false;
            }

            console.log(`Saving ${featureCount} buildings to IndexedDB via Web Worker...`);
            const startTime = performance.now();

            // Include metadata about the file
            const payload = {
                data: data,
                metadata: this.currentFileMetadata || {}
            };

            await this.sendToWorker('save', payload);

            const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
            console.log(`Buildings data saved successfully in ${elapsed}s (${featureCount} features)`);
            return true;
        } catch (error) {
            console.error('Failed to save buildings data:', error);

            // Handle quota errors
            if (error.message && error.message.includes('quota')) {
                console.warn('Storage quota exceeded. Try clearing old data or using a smaller dataset.');
                await this.clearStoredData();
            }

            return false;
        }
    }


    /**
     * Check if device is mobile/tablet
     */
    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    /**
     * Check if device is an older iPad (limited memory)
     */
    isOlderiPad() {
        const ua = navigator.userAgent;
        const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        // Rough heuristic: check for older iOS versions or limited memory indicators
        const memory = navigator.deviceMemory; // Some browsers support this
        return isIPad && (!memory || memory <= 4);
    }

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

        // Check if this is a different file than what's stored
        const storedMetadata = await this.getStoredMetadata();
        if (storedMetadata) {
            const isDifferent =
                storedMetadata.filename !== file.name ||
                storedMetadata.filesize !== file.size;

            if (isDifferent) {
                console.log(` New file detected: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
                console.log(` Clearing old data: ${storedMetadata.filename} (${(storedMetadata.filesize / 1024 / 1024).toFixed(1)}MB)`);

                this.showStatus('New file detected - clearing old data...', 'loading');
                await this.clearStoredData();

                // Small delay to show message
                await new Promise(resolve => setTimeout(resolve, 500));
            } else {
                console.log(' Same file as stored - will update data');
            }
        }

        // Store file metadata for saving later
        this.currentFileMetadata = {
            filename: file.name,
            filesize: file.size,
            filetype: file.type,
            uploadDate: new Date().toISOString()
        };

        // Show processing status for large files
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);

        // Check memory before processing
        const memInfo = this.checkMemory();
        console.log('Memory before file load:', memInfo);

        // Warn on mobile if file is very large
        if (this.isMobileDevice() && file.size > 30 * 1024 * 1024) {
            console.warn(`⚠️ Large file (${sizeMB}MB) on mobile device - may cause crash`);
            this.showStatus(`⚠️ Large file (${sizeMB}MB) - processing slowly to avoid crash...`, 'loading');
        } else if (file.size > 50 * 1024 * 1024) {
            this.showStatus(`Loading ${sizeMB}MB file, please wait...`, 'loading');
        } else {
            this.showStatus('Reading file...', 'loading');
        }

        // Store file metadata for saving later
        this.currentFileMetadata = {
            filename: file.name,
            filesize: file.size,
            filetype: file.type,
            uploadDate: new Date().toISOString()
        };

        try {
            if (window.crashLogger) {
                window.crashLogger.logEvent('FILE_LOAD_START', { size: file.size });
            }

            const data = await this.loadShapefile(file);

            if (window.crashLogger) {
                window.crashLogger.logEvent('FILE_LOAD_COMPLETE');
            }

            this.showStatus('Processing data...', 'loading');
            this.buildingsData = this.convertToGeoJSON(data);

            const featureCount = this.buildingsData.features.length;
            console.log(`Loaded ${featureCount} features, memory:`, this.checkMemory());

            // Save to IndexedDB for persistence
            if (window.crashLogger) {
                window.crashLogger.logEvent('SAVING_DATA', { featureCount });
            }
            await this.saveData(this.buildingsData);

            this.showStatus(`✓ Loaded ${featureCount} buildings successfully!`, 'success');

            setTimeout(() => {
                this.hideModal();
                window.dispatchEvent(new CustomEvent('buildingsLoaded', {
                    detail: this.buildingsData
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

            this.showStatus(`✗ Error: ${errorMsg}`, 'error');
        }
    }

    async loadShapefile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            // Track file reading progress
            reader.onprogress = (e) => {
                if (e.lengthComputable) {
                    const mbLoaded = (e.loaded / 1024 / 1024).toFixed(1);
                    const mbTotal = (e.total / 1024 / 1024).toFixed(1);
                    this.showStatus(`Reading file... ${mbLoaded} / ${mbTotal} MB`, 'loading');
                }
            };

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    console.log('File loaded, size:', arrayBuffer.byteLength, 'bytes');
                    console.log('File type:', file.type, 'Name:', file.name);
                    console.log('Memory after file read:', this.checkMemory());

                    // Check if we have enough memory for parsing (rough heuristic)
                    if (this.isMobileDevice() && arrayBuffer.byteLength > 20 * 1024 * 1024) {
                        console.warn('⚠️ Large file on mobile - proceeding with caution');
                        // Give browser time to stabilize
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    this.showStatus('Loading parser...', 'loading');
                    let shpModule;
                    try {
                        shpModule = await import('shpjs');
                        console.log('shpjs module loaded');
                    } catch (importError) {
                        console.error('Failed to load shpjs module:', importError);
                        throw new Error('Failed to load shapefile parser library');
                    }

                    this.showStatus('Parsing shapefile (please wait)...', 'loading');
                    console.log('Starting shapefile parse...');

                    let geojson;
                    try {
                        geojson = await shpModule.default(arrayBuffer);
                        console.log('GeoJSON parsed successfully');
                        console.log('Features:', geojson?.features?.length || 0);
                        console.log('Memory after parse:', this.checkMemory());
                    } catch (parseError) {
                        console.error('Shapefile parsing failed:', parseError);
                        throw new Error(`Parsing failed: ${parseError.message}`);
                    }

                    resolve(geojson);
                } catch (error) {
                    console.error('Shapefile loading error:', error);
                    console.error('Error stack:', error.stack);
                    reject(new Error(`Failed to parse shapefile: ${error.message}`));
                }
            };

            reader.onerror = (error) => {
                console.error('FileReader error:', error);
                reject(new Error('Failed to read file'));
            };

            try {
                reader.readAsArrayBuffer(file);
            } catch (error) {
                console.error('Failed to start file read:', error);
                reject(new Error('Failed to start reading file'));
            }
        });
    }

    convertToGeoJSON(data) {
        // Shapefile already contains point geometries (centroids)
        return data;
    }

    showStatus(message, type) {
        this.fileStatus.textContent = message;
        this.fileStatus.className = `file-status ${type}`;
    }

    hideModal() {
        this.modal.classList.add('hidden');
    }

    showModal() {
        this.modal.classList.remove('hidden');
    }

    getBuildingsData() {
        return this.buildingsData;
    }

    /**
     * Get current memory info (if available)
     */
    checkMemory() {
        if (performance.memory) {
            const used = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
            const limit = Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024);
            return { used: `${used}MB`, limit: `${limit}MB`, percentage: Math.round((used / limit) * 100) + '%' };
        }
        return { used: 'N/A', limit: 'N/A', percentage: 'N/A' };
    }

    /**
     * Get metadata about stored data
     */
    async getStoredMetadata() {
        try {
            const metadata = await this.sendToWorker('getMetadata');
            return metadata;
        } catch (error) {
            console.error('Failed to get metadata:', error);
            return null;
        }
    }

    /**
     * Check if stored data is available and get info
     */
    async getDataInfo() {
        const metadata = await this.getStoredMetadata();
        if (metadata) {
            return {
                exists: true,
                filename: metadata.filename,
                filesize: metadata.filesize,
                uploadDate: metadata.uploadDate,
                featureCount: this.buildingsData?.features?.length || 0
            };
        }
        return { exists: false };
    }

    /**
     * Clear stored buildings data from IndexedDB via Web Worker
     */
    async clearStoredData() {
        try {
            await this.sendToWorker('clear');
            this.buildingsData = null;
            console.log('Buildings data cleared from storage');
            return true;
        } catch (error) {
            console.error('Failed to clear buildings data:', error);
            return false;
        }
    }
}
