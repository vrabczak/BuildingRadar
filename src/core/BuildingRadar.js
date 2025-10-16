import { GPSManager } from './GPSManager.js';
import { DisplayManager } from './DisplayManager.js';
import { UIManager } from './UIManager.js';
import { SettingsManager } from './SettingsManager.js';
import { SpatialIndex } from './SpatialIndex.js';

/**
 * Main BuildingRadar class - Core application controller
 * Manages GPS tracking, UI updates and visualization
 */
export class BuildingRadar {
    constructor(buildingsData) {
        this.buildingsData = buildingsData;
        this.settings = new SettingsManager();
        this.ui = new UIManager();
        this.gps = new GPSManager(this.settings.getGPSSettings());
        this.display = new DisplayManager('radarCanvas', {
            radarRange: this.settings.get('radarRange')
        });

        // Initialize spatial index for fast queries
        this.spatialIndex = new SpatialIndex();
        this.spatialIndex.indexFeatures(buildingsData);

        this.updateInterval = null;
        this.isRunning = false;
        this.visibleBuildings = [];

        this.setupEventListeners();
        this.initialize();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // GPS events
        this.gps.addEventListener('connected', (e) => {
            console.log('GPS connected');
            this.ui.updateGPSStatus('connected', e.detail?.accuracy);
            this.ui.hideLoading();
            this.ui.hideError();
        });

        this.gps.addEventListener('disconnected', () => {
            console.log('GPS disconnected');
            this.ui.updateGPSStatus('disconnected');
        });

        this.gps.addEventListener('position', (e) => {
            this.handlePositionUpdate(e.detail);
        });

        this.gps.addEventListener('error', (e) => {
            console.error('GPS error:', e.detail);
            this.ui.showError(e.detail?.message || 'GPS error occurred');
            this.ui.updateGPSStatus('disconnected');
        });

        // UI events
        this.ui.addEventListener('retry', () => {
            if (!this.gps.isActive()) {
                this.startGPSWithPrompt();
            } else {
                this.restart();
            }
        });
    }

    /**
     * Initialize the application
     */
    async initialize() {
        try {
            this.ui.showLoading('Initializing GPS...');
            this.ui.updateGPSStatus('connecting');

            if (this.buildingsData && this.buildingsData.features) {
                console.log(`Loaded ${this.buildingsData.features.length} buildings`);
                this.display.updateBuildings(this.buildingsData.features);
            }

            if (this.isIOSStandalone()) {
                this.ui.hideLoading();
                this.ui.showError('For location access, please tap Retry');
                this.ui.updateGPSStatus('disconnected');
                return;
            }

            await this.gps.start();
            this.startUpdateLoop();
            this.isRunning = true;

            console.log('BuildingRadar initialized successfully');
        } catch (error) {
            console.error('Failed to initialize BuildingRadar:', error);
            this.ui.showError(error.message || 'Failed to initialize GPS');
            this.ui.updateGPSStatus('disconnected');
        }
    }

    /**
     * Handle GPS position update
     */
    handlePositionUpdate(position) {
        //console.log('Position update:', position);

        // Update display with new position
        this.display.updatePosition(position);

        // Update UI with accuracy
        this.ui.updateAccuracy(position.accuracy);

        // Calculate visible buildings
        this.updateVisibleBuildings(position);
    }

    /**
     * Update visible buildings within radar range
     */
    updateVisibleBuildings(position) {
        if (!this.buildingsData || !this.buildingsData.features) return;

        const radarRange = this.settings.get('radarRange');
        this.visibleBuildings = this.buildingsData.features.filter(building => {
            const coords = building.geometry.coordinates;
            const distance = this.calculateDistance(
                position.latitude,
                position.longitude,
                coords[1],
                coords[0]
            );
            return distance <= radarRange;
        });

        this.ui.updateBuildingCount(this.visibleBuildings.length);
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    isIOSStandalone() {
        const ua = navigator.userAgent || navigator.vendor || window.opera;
        const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isStandalone = (window.navigator.standalone === true) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
        return isIOS && isStandalone;
    }

    async startGPSWithPrompt() {
        try {
            this.ui.showLoading('Spouštím GPS...');
            this.ui.updateGPSStatus('connecting');
            await this.gps.start();
            if (!this.updateInterval) {
                this.startUpdateLoop();
            }
            this.isRunning = true;
            this.ui.hideLoading();
            this.ui.hideError();
        } catch (error) {
            this.ui.showError(error.message || 'Nepodařilo se spustit GPS');
            this.ui.updateGPSStatus('disconnected');
        }
    }

    /**
     * Start update loop (refreshes every second)
     */
    startUpdateLoop() {
        const refreshInterval = this.settings.get('refreshInterval');

        this.updateInterval = setInterval(() => {
            const lastPosition = this.gps.getLastPosition();
            if (lastPosition) {
                this.updateVisibleBuildings(lastPosition);
            }
        }, refreshInterval);

        console.log(`Update loop started with ${refreshInterval}ms interval`);
    }

    /**
     * Stop update loop
     */
    stopUpdateLoop() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            console.log('Update loop stopped');
        }
    }

    /**
     * Restart the application
     */
    async restart() {
        console.log('Restarting BuildingRadar...');
        this.stop();
        await this.initialize();
    }

    /**
     * Stop the application
     */
    stop() {
        this.isRunning = false;
        this.stopUpdateLoop();
        this.gps.stop();
        console.log('BuildingRadar stopped');
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stop();
        this.gps.destroy();
        this.display.destroy();
        this.ui.destroy();
        console.log('BuildingRadar destroyed');
    }
}