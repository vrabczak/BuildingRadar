/**
 * GPSManager - Handles geolocation with maximum precision and refresh rate
 */
export class GPSManager {
    constructor(settings = {}) {
        this.settings = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
            ...settings
        };

        this.watchId = null;
        this.isTracking = false;
        this.lastPosition = null;
        this.eventTarget = new EventTarget();

        this.onPositionSuccess = this.onPositionSuccess.bind(this);
        this.onPositionError = this.onPositionError.bind(this);
    }

    /**
     * Check if geolocation is supported
     */
    isSupported() {
        return 'geolocation' in navigator;
    }

    /**
     * Request location permission
     */
    async requestPermission() {
        if (!this.isSupported()) {
            throw new Error('Geolocation is not supported by this device');
        }

        try {
            // Try to get current position to trigger permission request
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    resolve,
                    reject,
                    {
                        enableHighAccuracy: true,
                        timeout: 15000,
                        maximumAge: 0
                    }
                );
            });

            return {
                granted: true,
                position: this.parsePosition(position)
            };
        } catch (error) {
            if (error.code === error.PERMISSION_DENIED) {
                return { granted: false, error: 'Permission denied' };
            }
            throw error;
        }
    }

    /**
     * Start GPS tracking
     */
    async start() {
        if (!this.isSupported()) {
            throw new Error('Geolocation is not supported');
        }

        if (this.isTracking) {
            console.warn('GPS tracking is already active');
            return;
        }

        try {
            // Request permission first
            const permissionResult = await this.requestPermission();
            if (!permissionResult.granted) {
                throw new Error(permissionResult.error || 'Location permission denied');
            }

            // Start watching position
            this.watchId = navigator.geolocation.watchPosition(
                this.onPositionSuccess,
                this.onPositionError,
                this.settings
            );

            this.isTracking = true;
            this.emit('connected', { accuracy: permissionResult.position?.accuracy });

            console.log('GPS tracking started with settings:', this.settings);
        } catch (error) {
            console.error('Failed to start GPS tracking:', error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Stop GPS tracking
     */
    stop() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        this.isTracking = false;
        this.emit('disconnected');
        console.log('GPS tracking stopped');
    }

    /**
     * Handle successful position update
     */
    onPositionSuccess(position) {
        const parsedPosition = this.parsePosition(position);
        this.lastPosition = parsedPosition;

        console.log('GPS position update:', parsedPosition);
        this.emit('position', parsedPosition);
    }

    /**
     * Handle position error
     */
    onPositionError(error) {
        let errorMessage = 'Unknown GPS error';

        switch (error.code) {
            case error.PERMISSION_DENIED:
                errorMessage = 'Location access denied by user';
                break;
            case error.POSITION_UNAVAILABLE:
                errorMessage = 'Location information unavailable';
                break;
            case error.TIMEOUT:
                errorMessage = 'Location request timed out';
                break;
        }

        console.error('GPS error:', errorMessage, error);
        this.emit('error', new Error(errorMessage));
    }

    /**
     * Parse position object from geolocation API
     */
    parsePosition(position) {
        return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: position.timestamp
        };
    }

    /**
     * Update GPS settings
     */
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };

        // If tracking is active, restart with new settings
        if (this.isTracking) {
            this.stop();
            setTimeout(() => this.start(), 100);
        }

        console.log('GPS settings updated:', this.settings);
    }

    /**
     * Get current position (one-time request)
     */
    async getCurrentPosition() {
        if (!this.isSupported()) {
            throw new Error('Geolocation is not supported');
        }

        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => resolve(this.parsePosition(position)),
                reject,
                this.settings
            );
        });
    }

    /**
     * Get last known position
     */
    getLastPosition() {
        return this.lastPosition;
    }

    /**
     * Check if GPS is currently tracking
     */
    isActive() {
        return this.isTracking;
    }

    /**
     * Get GPS accuracy level description
     */
    getAccuracyDescription(accuracy) {
        if (!accuracy) return 'Unknown';

        if (accuracy <= 5) return 'Excellent';
        if (accuracy <= 10) return 'Good';
        if (accuracy <= 20) return 'Fair';
        if (accuracy <= 50) return 'Poor';
        return 'Very Poor';
    }

    /**
     * Add event listener
     */
    addEventListener(event, callback) {
        this.eventTarget.addEventListener(event, callback);
    }

    /**
     * Remove event listener
     */
    removeEventListener(event, callback) {
        this.eventTarget.removeEventListener(event, callback);
    }

    /**
     * Emit event
     */
    emit(event, data) {
        this.eventTarget.dispatchEvent(new CustomEvent(event, { detail: data }));
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stop();
        this.eventTarget = null;
        this.lastPosition = null;
        console.log('GPSManager destroyed');
    }
}
