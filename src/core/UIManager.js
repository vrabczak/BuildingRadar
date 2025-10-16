/**
 * UIManager - Handles user interface interactions and updates
 */
export class UIManager {
    constructor() {
        this.elements = {
            statusBar: document.getElementById('statusBar'),
            gpsStatusText: document.getElementById('gpsStatusText'),
            accuracyValue: document.getElementById('accuracyValue'),
            buildingCountValue: document.getElementById('buildingCountValue'),
            errorMessage: document.getElementById('errorMessage'),
            errorText: document.getElementById('errorText'),
            retryButton: document.getElementById('retryButton'),
            loadingIndicator: document.getElementById('loadingIndicator')
        };

        this.eventTarget = new EventTarget();
        this.setupEventListeners();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        if (this.elements.retryButton) {
            this.elements.retryButton.addEventListener('click', () => {
                this.emit('retry');
            });
        }
    }

    /**
     * Update GPS status
     */
    updateGPSStatus(status, accuracy = null) {
        if (!this.elements.gpsStatusText) return;

        // Remove all status classes
        this.elements.gpsStatusText.classList.remove('connected', 'disconnected', 'connecting');

        switch (status) {
            case 'connected':
                this.elements.gpsStatusText.textContent = 'Connected';
                this.elements.gpsStatusText.classList.add('connected');
                break;
            case 'disconnected':
                this.elements.gpsStatusText.textContent = 'Disconnected';
                this.elements.gpsStatusText.classList.add('disconnected');
                break;
            case 'connecting':
                this.elements.gpsStatusText.textContent = 'Connecting...';
                this.elements.gpsStatusText.classList.add('connecting');
                break;
            default:
                this.elements.gpsStatusText.textContent = 'Unknown';
        }

        // Update accuracy if provided
        if (accuracy !== null && this.elements.accuracyValue) {
            this.updateAccuracy(accuracy);
        }
    }

    /**
     * Update GPS accuracy
     */
    updateAccuracy(accuracy) {
        if (!this.elements.accuracyValue) return;

        if (accuracy === null || accuracy === undefined) {
            this.elements.accuracyValue.textContent = '--';
            return;
        }

        this.elements.accuracyValue.textContent = `${Math.round(accuracy)}m`;
    }

    /**
     * Update building count
     */
    updateBuildingCount(count) {
        if (!this.elements.buildingCountValue) return;
        this.elements.buildingCountValue.textContent = count.toString();
    }

    /**
     * Show error message
     */
    showError(message) {
        if (!this.elements.errorMessage || !this.elements.errorText) return;

        this.elements.errorText.textContent = message;
        this.elements.errorMessage.classList.remove('hidden');
        this.hideLoading();
    }

    /**
     * Hide error message
     */
    hideError() {
        if (!this.elements.errorMessage) return;
        this.elements.errorMessage.classList.add('hidden');
    }

    /**
     * Show loading indicator
     */
    showLoading(message = 'Initializing GPS...') {
        if (!this.elements.loadingIndicator) return;

        const loadingText = this.elements.loadingIndicator.querySelector('p');
        if (loadingText) {
            loadingText.textContent = message;
        }

        this.elements.loadingIndicator.classList.remove('hidden');
    }

    /**
     * Hide loading indicator
     */
    hideLoading() {
        if (!this.elements.loadingIndicator) return;
        this.elements.loadingIndicator.classList.add('hidden');
    }

    /**
     * Show status bar
     */
    showStatusBar() {
        if (!this.elements.statusBar) return;
        this.elements.statusBar.style.display = 'flex';
    }

    /**
     * Hide status bar
     */
    hideStatusBar() {
        if (!this.elements.statusBar) return;
        this.elements.statusBar.style.display = 'none';
    }

    /**
     * Update all UI elements
     */
    updateAll(data) {
        if (data.gpsStatus) {
            this.updateGPSStatus(data.gpsStatus, data.accuracy);
        }
        if (data.accuracy !== undefined) {
            this.updateAccuracy(data.accuracy);
        }
        if (data.buildingCount !== undefined) {
            this.updateBuildingCount(data.buildingCount);
        }
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
     * Cleanup
     */
    destroy() {
        if (this.elements.retryButton) {
            this.elements.retryButton.removeEventListener('click', () => {
                this.emit('retry');
            });
        }
        this.eventTarget = null;
    }
}