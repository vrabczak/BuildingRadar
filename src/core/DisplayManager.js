/**
 * DisplayManager - Handles canvas-based visualization of grid, circles, and position
 */
export class DisplayManager {
    constructor(canvasId, settings = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas element with id '${canvasId}' not found`);
        }

        this.ctx = this.canvas.getContext('2d');
        this.settings = {
            radarRange: 1000, // 1km in meters
            backgroundColor: '#0a0a0a',
            radarColor: '#00ff00',
            buildingColor: '#ff0000',
            centerColor: '#00ff00',
            gridColor: 'rgba(0, 255, 0, 0.2)',
            sweepColor: 'rgba(0, 255, 0, 0.1)',
            ...settings
        };

        this.centerX = 0;
        this.centerY = 0;
        this.radius = 0;
        this.heading = 0; // User heading in degrees (0 = North)
        this.buildings = [];
        this.userPosition = null;
        this.sweepAngle = 0;

        this.setupCanvas();
        this.startAnimation();

        // Handle window resize
        window.addEventListener('resize', () => this.setupCanvas());
    }

    /**
     * Setup canvas dimensions and scaling
     */
    setupCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;

        this.ctx.scale(dpr, dpr);

        // Calculate center and radius
        this.centerX = rect.width / 2;
        this.centerY = rect.height / 2;
        this.radius = Math.min(rect.width, rect.height) * 0.4;
    }

    /**
     * Start animation loop
     */
    startAnimation() {
        const animate = () => {
            this.render();
            requestAnimationFrame(animate);
        };
        animate();
    }

    /**
     * Main render function
     */
    render() {
        this.clear();
        this.drawRadarBackground();
        this.drawGrid();
        this.drawRangeCircles();
        this.drawSweep();
        this.drawBuildings();
        this.drawCenter();
        this.drawCompass();
    }

    /**
     * Clear canvas
     */
    clear() {
        const rect = this.canvas.getBoundingClientRect();
        this.ctx.fillStyle = this.settings.backgroundColor;
        this.ctx.fillRect(0, 0, rect.width, rect.height);
    }

    /**
     * Draw radar background circle
     */
    drawRadarBackground() {
        this.ctx.beginPath();
        this.ctx.arc(this.centerX, this.centerY, this.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = 'rgba(0, 50, 0, 0.1)';
        this.ctx.fill();
        this.ctx.strokeStyle = this.settings.radarColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
    }

    /**
     * Draw grid lines
     */
    drawGrid() {
        this.ctx.strokeStyle = this.settings.gridColor;
        this.ctx.lineWidth = 1;

        // Draw crosshair (rotated based on heading)
        this.ctx.save();
        this.ctx.translate(this.centerX, this.centerY);
        this.ctx.rotate(this.degreesToRadians(-this.heading));

        // Vertical line (North-South)
        this.ctx.beginPath();
        this.ctx.moveTo(0, -this.radius);
        this.ctx.lineTo(0, this.radius);
        this.ctx.stroke();

        // Horizontal line (East-West)
        this.ctx.beginPath();
        this.ctx.moveTo(-this.radius, 0);
        this.ctx.lineTo(this.radius, 0);
        this.ctx.stroke();

        this.ctx.restore();
    }

    /**
     * Draw range circles
     */
    drawRangeCircles() {
        this.ctx.strokeStyle = this.settings.gridColor;
        this.ctx.lineWidth = 1;

        // Draw circles at 250m, 500m, 750m, 1000m
        const ranges = [0.25, 0.5, 0.75, 1.0];
        ranges.forEach(range => {
            const r = this.radius * range;
            this.ctx.beginPath();
            this.ctx.arc(this.centerX, this.centerY, r, 0, Math.PI * 2);
            this.ctx.stroke();
        });
    }

    /**
     * Draw radar sweep effect
     */
    drawSweep() {
        this.sweepAngle = (this.sweepAngle + 2) % 360;

        this.ctx.save();
        this.ctx.translate(this.centerX, this.centerY);
        this.ctx.rotate(this.degreesToRadians(this.sweepAngle));

        // Draw sweep gradient
        const gradient = this.ctx.createLinearGradient(0, 0, 0, -this.radius);
        gradient.addColorStop(0, 'rgba(0, 255, 0, 0)');
        gradient.addColorStop(0.5, 'rgba(0, 255, 0, 0.1)');
        gradient.addColorStop(1, 'rgba(0, 255, 0, 0.3)');

        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.arc(0, 0, this.radius, -Math.PI / 6, Math.PI / 6);
        this.ctx.closePath();
        this.ctx.fillStyle = gradient;
        this.ctx.fill();

        this.ctx.restore();
    }

    /**
     * Draw buildings as red dots
     */
    drawBuildings() {
        if (!this.userPosition || this.buildings.length === 0) return;

        this.buildings.forEach(building => {
            const coords = building.geometry.coordinates;
            const buildingLat = coords[1];
            const buildingLon = coords[0];

            // Calculate distance and bearing from user to building
            const distance = this.calculateDistance(
                this.userPosition.latitude,
                this.userPosition.longitude,
                buildingLat,
                buildingLon
            );

            // Only draw if within radar range
            if (distance <= this.settings.radarRange) {
                const bearing = this.calculateBearing(
                    this.userPosition.latitude,
                    this.userPosition.longitude,
                    buildingLat,
                    buildingLon
                );

                // Adjust bearing relative to user heading (front is up)
                const relativeBearing = bearing - this.heading;

                // Convert to radar coordinates
                const radarCoords = this.polarToCartesian(
                    distance,
                    relativeBearing,
                    this.settings.radarRange,
                    this.radius
                );

                // Draw building dot
                this.ctx.beginPath();
                this.ctx.arc(
                    this.centerX + radarCoords.x,
                    this.centerY - radarCoords.y, // Negative Y because canvas Y increases downward
                    4,
                    0,
                    Math.PI * 2
                );
                this.ctx.fillStyle = this.settings.buildingColor;
                this.ctx.fill();

                // Add glow effect
                this.ctx.shadowBlur = 10;
                this.ctx.shadowColor = this.settings.buildingColor;
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            }
        });
    }

    /**
     * Draw center point (user position)
     */
    drawCenter() {
        // Draw pulsing center point
        const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.7;

        this.ctx.beginPath();
        this.ctx.arc(this.centerX, this.centerY, 6 * pulse, 0, Math.PI * 2);
        this.ctx.fillStyle = this.settings.centerColor;
        this.ctx.fill();

        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = this.settings.centerColor;
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        // Draw direction indicator (triangle pointing up)
        this.ctx.save();
        this.ctx.translate(this.centerX, this.centerY);
        this.ctx.rotate(this.degreesToRadians(-this.heading));

        this.ctx.beginPath();
        this.ctx.moveTo(0, -15);
        this.ctx.lineTo(-6, -5);
        this.ctx.lineTo(6, -5);
        this.ctx.closePath();
        this.ctx.fillStyle = this.settings.centerColor;
        this.ctx.fill();

        this.ctx.restore();
    }

    /**
     * Draw compass indicator
     */
    drawCompass() {
        const compassRadius = 30;
        const compassX = this.centerX;
        const compassY = 50;

        // Draw compass circle
        this.ctx.beginPath();
        this.ctx.arc(compassX, compassY, compassRadius, 0, Math.PI * 2);
        this.ctx.strokeStyle = this.settings.radarColor;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Draw North indicator
        this.ctx.save();
        this.ctx.translate(compassX, compassY);
        this.ctx.rotate(this.degreesToRadians(-this.heading));

        this.ctx.beginPath();
        this.ctx.moveTo(0, -compassRadius + 5);
        this.ctx.lineTo(-5, -compassRadius + 15);
        this.ctx.lineTo(5, -compassRadius + 15);
        this.ctx.closePath();
        this.ctx.fillStyle = this.settings.radarColor;
        this.ctx.fill();

        // Draw 'N' label
        this.ctx.fillStyle = this.settings.radarColor;
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('N', 0, -compassRadius + 25);

        this.ctx.restore();
    }

    /**
     * Update user position and heading
     */
    updatePosition(position) {
        this.userPosition = position;
        if (position.heading !== null && position.heading !== undefined) {
            this.heading = position.heading;
        }
    }

    /**
     * Update buildings data
     */
    updateBuildings(buildings) {
        this.buildings = buildings;
    }

    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const φ1 = this.degreesToRadians(lat1);
        const φ2 = this.degreesToRadians(lat2);
        const Δφ = this.degreesToRadians(lat2 - lat1);
        const Δλ = this.degreesToRadians(lon2 - lon1);

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    /**
     * Calculate bearing between two coordinates
     */
    calculateBearing(lat1, lon1, lat2, lon2) {
        const φ1 = this.degreesToRadians(lat1);
        const φ2 = this.degreesToRadians(lat2);
        const Δλ = this.degreesToRadians(lon2 - lon1);

        const y = Math.sin(Δλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
        const θ = Math.atan2(y, x);

        return (this.radiansToDegrees(θ) + 360) % 360;
    }

    /**
     * Convert polar coordinates to cartesian
     */
    polarToCartesian(distance, bearing, maxDistance, maxRadius) {
        const normalizedDistance = (distance / maxDistance) * maxRadius;
        const angleRad = this.degreesToRadians(bearing);

        return {
            x: normalizedDistance * Math.sin(angleRad),
            y: normalizedDistance * Math.cos(angleRad)
        };
    }

    /**
     * Convert degrees to radians
     */
    degreesToRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Convert radians to degrees
     */
    radiansToDegrees(radians) {
        return radians * (180 / Math.PI);
    }

    /**
     * Cleanup
     */
    destroy() {
        window.removeEventListener('resize', () => this.setupCanvas());
    }
}