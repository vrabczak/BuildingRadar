import shp from 'shpjs';

/**
 * StorageConfig - Centralized configuration for chunking and caching
 * Adjust these values to optimize performance for different dataset sizes and devices
 */
export const StorageConfig = {
    // Feature chunking
    CHUNK_SIZE: 1000,              // Number of features per chunk (affects memory usage)

    // Network/Worker batching
    STREAM_BATCH_SIZE: 10,          // Number of chunks sent per postMessage to worker
    SUB_BATCH_SIZE: 10,             // Number of chunks per IndexedDB transaction

    // Memory management
    MAX_CACHED_CHUNKS: 10,          // Maximum chunks kept in memory (LRU cache)

    // Spatial index
    DEFAULT_CELL_SIZE: 0.01,        // Grid cell size in degrees (~1km at equator)
};

/**
 * SettingsManager - Handles application settings with persistence and validation
 */
export class SettingsManager {
    constructor() {
        this.storageKey = 'buildingRadarSettings';
        this.defaults = {
            radarRange: 2000, // meters
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