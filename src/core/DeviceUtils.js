/**
 * DeviceUtils - Static utility methods for device detection and memory monitoring
 */
export class DeviceUtils {
    /**
     * Check if device is mobile/tablet
     */
    static isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    /**
     * Check if device is an older iPad (limited memory)
     */
    static isOlderiPad() {
        const ua = navigator.userAgent;
        const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        // Rough heuristic: check for older iOS versions or limited memory indicators
        const memory = navigator.deviceMemory; // Some browsers support this
        return isIPad && (!memory || memory <= 4);
    }

    /**
     * Get current memory info (if available)
     */
    static checkMemory() {
        if (performance.memory) {
            const used = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
            const limit = Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024);
            return { used: `${used}MB`, limit: `${limit}MB`, percentage: Math.round((used / limit) * 100) + '%' };
        }
        return { used: 'N/A', limit: 'N/A', percentage: 'N/A' };
    }
}