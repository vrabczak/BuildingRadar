import shp from 'shpjs';

/**
 * SettingsManager - Handles application settings with persistence and validation
 */
export class SettingsManager {
    constructor() {
        this.storageKey = 'buildingRadarSettings';
        this.defaults = {
            radarRange: 1000, // meters
            refreshInterval: 1000, // milliseconds
            enableHighAccuracy: true,
            gpsTimeout: 10000,
            gpsMaximumAge: 0
        };

        this.settings = this.loadSettings();
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                return { ...this.defaults, ...parsed };
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
        return { ...this.defaults };
    }

    /**
     * Save settings to localStorage
     */
    saveSettings() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
            return true;
        } catch (error) {
            console.error('Failed to save settings:', error);
            return false;
        }
    }

    /**
     * Get a setting value
     */
    get(key) {
        return this.settings[key];
    }

    /**
     * Set a setting value
     */
    set(key, value) {
        this.settings[key] = value;
        this.saveSettings();
    }

    /**
     * Get all settings
     */
    getAll() {
        return { ...this.settings };
    }

    /**
     * Update multiple settings
     */
    update(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.saveSettings();
    }

    /**
     * Reset to defaults
     */
    reset() {
        this.settings = { ...this.defaults };
        this.saveSettings();
    }

    /**
     * Get GPS settings for geolocation API
     */
    getGPSSettings() {
        return {
            enableHighAccuracy: this.settings.enableHighAccuracy,
            timeout: this.settings.gpsTimeout,
            maximumAge: this.settings.gpsMaximumAge
        };
    }
}

/**
 * DataLoader - Handles loading and parsing of shapefile data
 */
export class DataLoader {
    constructor() {
        this.buildingsData = null;
        this.fileInput = document.getElementById('shapefileInput');
        this.fileStatus = document.getElementById('fileStatus');
        this.modal = document.getElementById('fileInputModal');

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.showStatus('Loading shapefile...', 'loading');

        try {
            const data = await this.loadShapefile(file);
            this.buildingsData = this.convertToGeoJSON(data);

            const featureCount = this.buildingsData.features.length;
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

            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    console.log('File loaded, size:', arrayBuffer.byteLength, 'bytes');
                    console.log('File type:', file.type, 'Name:', file.name);

                    const shpModule = await import('shpjs');
                    console.log('shpjs module loaded');

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
}