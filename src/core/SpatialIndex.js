/**
 * SpatialIndex - Grid-based spatial index for fast proximity queries
 * Supports direct IndexedDB serialization for memory-efficient storage
 */
export class SpatialIndex {
    constructor(cellSize = 0.01) { // ~1km at equator
        this.cellSize = cellSize;
        this.grid = new Map();
        this.allFeatures = [];
        this.isLoaded = false;
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
        this.isLoaded = false;
    }

    /**
     * Add a single feature to the index (for streaming/chunked loading)
     */
    addFeature(feature) {
        if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            const key = this.getCellKey(lon, lat);

            const index = this.allFeatures.length;
            this.allFeatures.push(feature);

            if (!this.grid.has(key)) {
                this.grid.set(key, []);
            }
            this.grid.get(key).push(index);
        }
    }

    /**
     * Serialize to plain object for IndexedDB storage
     * Returns chunked data to avoid memory spikes
     */
    serialize() {
        // Convert Map to plain object with array values
        const gridObject = {};
        for (const [key, indices] of this.grid.entries()) {
            gridObject[key] = indices;
        }

        return {
            cellSize: this.cellSize,
            grid: gridObject,
            featureCount: this.allFeatures.length,
            // Features stored separately in chunks
        };
    }

    /**
     * Serialize features in chunks for memory-efficient storage
     * @param {number} chunkSize - Number of features per chunk
     * @returns {Array} Array of feature chunks
     */
    serializeFeatures(chunkSize = 10000) {
        const chunks = [];
        for (let i = 0; i < this.allFeatures.length; i += chunkSize) {
            chunks.push(this.allFeatures.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Deserialize from IndexedDB storage
     * @param {Object} data - Serialized index data
     */
    deserialize(data) {
        this.cellSize = data.cellSize;

        // Convert plain object back to Map
        this.grid.clear();
        for (const [key, indices] of Object.entries(data.grid)) {
            this.grid.set(key, indices);
        }

        // Features loaded separately
        this.isLoaded = true;
    }

    /**
     * Load features from chunks
     * @param {Array} chunks - Array of feature chunks
     */
    loadFeatureChunks(chunks) {
        this.allFeatures = [];
        for (const chunk of chunks) {
            this.allFeatures.push(...chunk);
        }
        console.log(`Loaded ${this.allFeatures.length} features from ${chunks.length} chunks`);
    }

    /**
     * Get index metadata
     */
    getMetadata() {
        return {
            cellSize: this.cellSize,
            gridCells: this.grid.size,
            featureCount: this.allFeatures.length,
            isLoaded: this.isLoaded
        };
    }
}
