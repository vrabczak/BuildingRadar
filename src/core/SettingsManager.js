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
        this.defaults = {
            radarRange: 2000, // meters
            refreshInterval: 1000, // milliseconds
            enableHighAccuracy: true,
            gpsTimeout: 10000,
            gpsMaximumAge: 0
        };

        // Clear any old stored settings
        try {
            localStorage.removeItem('buildingRadarSettings');
        } catch (error) {
            // Ignore errors
        }

        // Use in-memory settings only
        this.settings = { ...this.defaults };
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
    }

    /**
     * Reset to defaults
     */
    reset() {
        this.settings = { ...this.defaults };
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