/**
 * DataLoader - Handles loading and parsing of shapefile data with progress tracking
 */
export class DataLoader {
    constructor() {
        this.buildingsData = null;
        this.fileInput = document.getElementById('shapefileInput');
        this.fileStatus = document.getElementById('fileStatus');
        this.modal = document.getElementById('fileInputModal');
        this.storageKey = 'buildingRadarData';
        this.dbName = 'BuildingRadarDB';
        this.dbVersion = 1;
        this.maxFileSizeMobile = 50 * 1024 * 1024; // 50MB limit for mobile devices

        this.setupEventListeners();
        this.initDB().then(() => this.restoreData());
    }

    setupEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    /**
     * Initialize IndexedDB for storing large datasets
     */
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('IndexedDB initialized');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('buildings')) {
                    db.createObjectStore('buildings', { keyPath: 'id' });
                    console.log('Created buildings object store');
                }
            };
        });
    }

    /**
     * Restore buildings data from IndexedDB if available
     */
    async restoreData() {
        try {
            if (!this.db) {
                console.warn('IndexedDB not initialized yet');
                return false;
            }

            console.log('Restoring buildings data from IndexedDB...');
            const data = await this.getDataFromDB();

            if (data) {
                this.buildingsData = data;
                const featureCount = this.buildingsData?.features?.length || 0;
                if (featureCount > 0) {
                    console.log(`Restored ${featureCount} buildings from storage`);
                    // Hide modal since we have data
                    this.hideModal();
                    // Dispatch event immediately so app can initialize
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
     * Get data from IndexedDB
     */
    async getDataFromDB() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['buildings'], 'readonly');
            const store = transaction.objectStore('buildings');
            const request = store.get(this.storageKey);

            request.onsuccess = () => {
                resolve(request.result?.data);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Save buildings data to IndexedDB (supports large datasets)
     */
    async saveData(data) {
        try {
            const featureCount = data?.features?.length || 0;
            if (featureCount === 0) {
                console.warn('No features to save');
                return false;
            }

            if (!this.db) {
                console.warn('IndexedDB not initialized, cannot save data');
                return false;
            }

            console.log(`Saving ${featureCount} buildings to IndexedDB...`);

            await this.saveDataToDB(data);

            console.log(`Buildings data saved successfully (${featureCount} features)`);
            return true;
        } catch (error) {
            console.error('Failed to save buildings data:', error);

            // Handle quota errors
            if (error.name === 'QuotaExceededError') {
                console.warn('Storage quota exceeded. Try clearing old data or using a smaller dataset.');
                // Optionally clear old data
                await this.clearStoredData();
            }

            return false;
        }
    }

    /**
     * Save data to IndexedDB
     */
    async saveDataToDB(data) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['buildings'], 'readwrite');
            const store = transaction.objectStore('buildings');
            const request = store.put({
                id: this.storageKey,
                data: data,
                timestamp: Date.now()
            });

            request.onsuccess = () => {
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
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

        // Check file size on mobile devices
        if (this.isMobileDevice() && file.size > this.maxFileSizeMobile) {
            const sizeMB = (file.size / 1024 / 1024).toFixed(1);
            const maxMB = (this.maxFileSizeMobile / 1024 / 1024).toFixed(0);
            const proceed = confirm(
                `Warning: This file is ${sizeMB}MB which may cause issues on mobile devices (recommended max: ${maxMB}MB). ` +
                `The app may become slow or crash. Continue anyway?`
            );
            if (!proceed) {
                this.fileInput.value = ''; // Clear the file input
                return;
            }
        }

        // Additional warning for older iPads with very large files
        if (this.isOlderiPad() && file.size > 20 * 1024 * 1024) {
            this.showStatus('⚠ Large file detected. Processing may take a while...', 'loading');
        } else {
            this.showStatus('Reading file...', 'loading');
        }

        try {
            const data = await this.loadShapefile(file);

            this.showStatus('Processing data...', 'loading');
            this.buildingsData = this.convertToGeoJSON(data);

            const featureCount = this.buildingsData.features.length;

            // Save to localStorage for persistence
            this.saveData(this.buildingsData);

            this.showStatus(`✓ Loaded ${featureCount} buildings successfully!`, 'success');

            setTimeout(() => {
                this.hideModal();
                window.dispatchEvent(new CustomEvent('buildingsLoaded', {
                    detail: this.buildingsData
                }));
            }, 1000);
        } catch (error) {
            console.error('Error loading shapefile:', error);
            this.showStatus(`✗ Error: ${error.message}`, 'error');
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

                    this.showStatus('Loading parser...', 'loading');
                    const shpModule = await import('shpjs');
                    console.log('shpjs module loaded');

                    this.showStatus('Parsing shapefile (please wait)...', 'loading');
                    const geojson = await shpModule.default(arrayBuffer);

                    console.log('GeoJSON parsed:', geojson);

                    resolve(geojson);
                } catch (error) {
                    console.error('Shapefile parsing error:', error);
                    reject(new Error(`Failed to parse shapefile: ${error.message}`));
                }
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
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
     * Clear stored buildings data from IndexedDB
     */
    async clearStoredData() {
        try {
            if (!this.db) {
                console.warn('IndexedDB not initialized');
                return false;
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['buildings'], 'readwrite');
                const store = transaction.objectStore('buildings');
                const request = store.delete(this.storageKey);

                request.onsuccess = () => {
                    this.buildingsData = null;
                    console.log('Buildings data cleared from storage');
                    resolve(true);
                };

                request.onerror = () => {
                    console.error('Failed to clear buildings data:', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error('Failed to clear buildings data:', error);
            return false;
        }
    }
}
