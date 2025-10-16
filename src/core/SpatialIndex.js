/**
 * SpatialIndex - Grid-based spatial index for fast proximity queries
 */
export class SpatialIndex {
    constructor(cellSize = 0.01) { // ~1km at equator
        this.cellSize = cellSize;
        this.grid = new Map();
        this.allFeatures = [];
    }

    /**
     * Get grid cell key for coordinates
     */
    getCellKey(lon, lat) {
        const cellX = Math.floor(lon / this.cellSize);
        const cellY = Math.floor(lat / this.cellSize);
        return `${cellX},${cellY}`;
    }

    /**
     * Index all features from GeoJSON
     */
    indexFeatures(geojson) {
        console.log('Building spatial index...');
        const startTime = performance.now();

        this.allFeatures = geojson.features;
        this.grid.clear();

        geojson.features.forEach((feature, index) => {
            if (feature.geometry.type === 'Point') {
                const [lon, lat] = feature.geometry.coordinates;
                const key = this.getCellKey(lon, lat);

                if (!this.grid.has(key)) {
                    this.grid.set(key, []);
                }
                this.grid.get(key).push(index);
            }
        });

        const endTime = performance.now();
        console.log(`Spatial index built in ${(endTime - startTime).toFixed(2)}ms`);
        console.log(`Grid cells: ${this.grid.size}, Features: ${this.allFeatures.length}`);
    }

    /**
     * Query features within radius of a point
     */
    queryRadius(centerLon, centerLat, radiusMeters) {
        // Convert radius to degrees (approximate)
        const radiusDeg = radiusMeters / 111320; // meters to degrees at equator

        // Calculate cell range to check
        const cellRadius = Math.ceil(radiusDeg / this.cellSize);
        const centerCellX = Math.floor(centerLon / this.cellSize);
        const centerCellY = Math.floor(centerLat / this.cellSize);

        const results = [];
        const radiusSquared = radiusDeg * radiusDeg;

        // Check cells in range
        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
            for (let dy = -cellRadius; dy <= cellRadius; dy++) {
                const key = `${centerCellX + dx},${centerCellY + dy}`;
                const cellIndices = this.grid.get(key);

                if (cellIndices) {
                    cellIndices.forEach(index => {
                        const feature = this.allFeatures[index];
                        const [lon, lat] = feature.geometry.coordinates;

                        // Calculate distance squared (faster than sqrt)
                        const dLon = lon - centerLon;
                        const dLat = lat - centerLat;
                        const distSquared = dLon * dLon + dLat * dLat;

                        if (distSquared <= radiusSquared) {
                            results.push(feature);
                        }
                    });
                }
            }
        }

        return results;
    }

    /**
     * Get total number of indexed features
     */
    getFeatureCount() {
        return this.allFeatures.length;
    }

    /**
     * Clear the index
     */
    clear() {
        this.grid.clear();
        this.allFeatures = [];
    }
}
