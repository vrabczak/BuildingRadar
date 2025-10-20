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
    constructor(spatialIndex) {
        if (!spatialIndex || typeof spatialIndex.queryRadius !== 'function') {
            throw new Error('BuildingRadar requires a valid SpatialIndex instance');
        }

        this.spatialIndex = spatialIndex;
        console.log(`Using spatial index with ${spatialIndex.getFeatureCount()} features`);

        this.settings = new SettingsManager();
        this.ui = new UIManager();
        this.gps = new GPSManager(this.settings.getGPSSettings());
        this.display = new DisplayManager('radarCanvas', {
            radarRange: this.settings.get('radarRange')
        });

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
     * Initialize the application (does NOT start GPS)
     */
    async initialize() {
        try {
            if (this.spatialIndex) {
                const featureCount = this.spatialIndex.getFeatureCount();
                console.log(`BuildingRadar initialized with ${featureCount} buildings`);
                // Initially no buildings visible until GPS position is received
                this.display.updateBuildings([]);
            }

            console.log('BuildingRadar initialized (GPS not started yet)');
        } catch (error) {
            console.error('Failed to initialize BuildingRadar:', error);
            this.ui.showError(error.message || 'Failed to initialize');
        }
    }

    /**
     * Start GPS tracking (requests location permission)
     */
    async startGPS() {
        try {
            this.ui.showLoading('Starting GPS...');
            this.ui.updateGPSStatus('connecting');

            if (this.isIOSStandalone()) {
                this.ui.hideLoading();
                this.ui.showError('For location access, please tap Retry');
                this.ui.updateGPSStatus('disconnected');
                return false;
            }

            await this.gps.start();
            this.startUpdateLoop();
            this.isRunning = true;
            this.ui.hideLoading();

            console.log('GPS started successfully');
            return true;
        } catch (error) {
            console.error('Failed to start GPS:', error);
            this.ui.showError(error.message || 'Failed to start GPS');
            this.ui.updateGPSStatus('disconnected');
            return false;
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

        // Calculate visible buildings using spatial index (async for lazy loading)
        this.updateVisibleBuildings(position).catch(err => {
            console.error('Failed to update visible buildings:', err);
        });
    }

    /**
     * Update visible buildings within radar range using spatial index
     * Async to support lazy loading of chunks
     */
    async updateVisibleBuildings(position) {
        if (!this.spatialIndex) return;

        const radarRange = this.settings.get('radarRange');

        // Use spatial index for fast query (async for lazy loading)
        this.visibleBuildings = await this.spatialIndex.queryRadius(
            position.longitude,
            position.latitude,
            radarRange
        );

        // Update display with visible buildings only
        this.display.updateBuildings(this.visibleBuildings);

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
            this.ui.showLoading('Starting GPS...');
            this.ui.updateGPSStatus('connecting');
            await this.gps.start();
            if (!this.updateInterval) {
                this.startUpdateLoop();
            }
            this.isRunning = true;
            this.ui.hideLoading();
            this.ui.hideError();
        } catch (error) {
            console.error('GPS start error:', error);
            let errorMsg = error.message || 'Failed to start GPS';

            // Provide iOS-specific guidance for permission issues
            if (this.isIOSStandalone() && errorMsg.includes('denied')) {
                errorMsg = 'Location denied. Go to Settings > Safari > Location Services > Allow';
            }

            this.ui.showError(errorMsg);
            this.ui.updateGPSStatus('disconnected');
        }
    }

    /**
     * Start update loop (refreshes every second)
     */
    startUpdateLoop() {
        const refreshInterval = this.settings.get('refreshInterval');

        this.updateInterval = setInterval(async () => {
            const lastPosition = this.gps.getLastPosition();
            if (lastPosition) {
                await this.updateVisibleBuildings(lastPosition).catch(err => {
                    console.error('Failed to update visible buildings:', err);
                });
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