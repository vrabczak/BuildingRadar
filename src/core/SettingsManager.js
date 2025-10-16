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