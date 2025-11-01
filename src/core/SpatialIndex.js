import { StorageConfig } from './SettingsManager.js';

/**
 * SpatialIndex - Grid-based spatial index for fast proximity queries
 * Supports direct IndexedDB serialization for memory-efficient storage
 */
export class SpatialIndex {
    constructor(cellSize = StorageConfig.DEFAULT_CELL_SIZE) { // ~1km at equator
        this.cellSize = cellSize;
        this.grid = new Map(); // cellKey -> [featureIndices]
        this.allFeatures = []; // Legacy: all features in memory
        this.featureCount = 0; // Total count (works in both modes)
        this.isLoaded = false;

        // Lazy loading support
        this.lazyMode = false;
        this.chunkMap = new Map(); // chunkId -> [features]
        this.chunkMetadata = new Map(); // cellKey -> [chunkIds]
        this.chunkBoundaries = []; // Array of {start, end, shapefileName} for variable-sized chunks
        this.featureToChunk = null; // Uint32Array mapping global index -> chunkId
        this._lastChunkLookup = { chunkId: -1, start: -1, end: -1 };
        this.loadedChunks = new Set(); // Set of loaded chunkIds
        this.chunkCache = []; // LRU cache: [{id, lastAccess}]
        this.maxCachedChunks = StorageConfig.MAX_CACHED_CHUNKS; // Keep N chunks in memory
        this.chunkLoader = null; // Function to load chunk by ID
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
     * Parse cell key string to coordinates
     * @param {string} cellKey - Cell key in format "x,y"
     * @returns {Array<number>} [x, y] coordinates
     */
    parseCellKey(cellKey) {
        const [x, y] = cellKey.split(',').map(Number);
        return [x, y];
    }

    /**
     * Calculate distance between two points using Haversine formula
     * @param {number} lat1 - Latitude of first point
     * @param {number} lon1 - Longitude of first point
     * @param {number} lat2 - Latitude of second point
     * @param {number} lon2 - Longitude of second point
     * @returns {number} Distance in meters
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Index all features from GeoJSON
     */
    indexFeatures(geojson) {
        console.log('Building spatial index...');
        const startTime = performance.now();

        this.allFeatures = geojson.features;
        this.featureCount = geojson.features.length;
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
        console.log(`Grid cells: ${this.grid.size}, Features: ${this.featureCount}`);
    }

    /**
     * Query all features within radius of a point
     * In lazy mode, automatically loads required chunks
     */
    async queryRadius(lon, lat, radius) {
        const features = [];
        const centerKey = this.getCellKey(lon, lat);
        const [centerCellX, centerCellY] = this.parseCellKey(centerKey);

        // Calculate grid cell range to check
        const cellRange = Math.ceil(radius / (this.cellSize * 111000)); // Approximate degrees

        console.log(`🔍 Query at [${lat.toFixed(6)}, ${lon.toFixed(6)}], radius=${radius}m, cellRange=${cellRange}`);

        const cellsToCheck = [];
        for (let dx = -cellRange; dx <= cellRange; dx++) {
            for (let dy = -cellRange; dy <= cellRange; dy++) {
                cellsToCheck.push(`${centerCellX + dx},${centerCellY + dy}`);
            }
        }

        if (this.lazyMode) {
            const neededChunks = new Set();

            for (const cellKey of cellsToCheck) {
                const chunkIds = this.getChunksForCell(cellKey);
                chunkIds.forEach(id => neededChunks.add(id));
            }

            console.log(`📦 Need ${neededChunks.size} chunks for this query: [${Array.from(neededChunks).join(', ')}]`);

            await this.ensureChunksLoaded(Array.from(neededChunks));
        }

        // Query features from loaded data
        let cellsChecked = 0;
        let cellsWithData = 0;
        for (const checkKey of cellsToCheck) {
            const indices = this.grid.get(checkKey);
            cellsChecked++;

            // Debug: Log first few cells
            if (cellsChecked <= 5) {
                console.log(`  🔍 Cell ${checkKey}: ${indices ? indices.length + ' indices' : 'no data'}`);
            }

            if (indices) cellsWithData++;
            if (indices) {
                for (const idx of indices) {
                    const feature = this.getFeature(idx);
                    if (feature) {
                        const [fLon, fLat] = feature.geometry.coordinates;
                        const distance = this.calculateDistance(lat, lon, fLat, fLon);

                        if (distance <= radius) {
                            features.push({
                                ...feature,
                                distance
                            });
                        }
                    }
                }
            }
        }

        console.log(`🔎 Checked ${cellsChecked} cells, ${cellsWithData} had data`);
        console.log(`✅ Found ${features.length} buildings within ${radius}m`);

        return features;
    }

    /**
     * Get total number of indexed features
     */
    getFeatureCount() {
        return this.lazyMode ? this.featureCount : this.allFeatures.length;
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
            this.featureCount = this.allFeatures.length;

            if (!this.grid.has(key)) {
                this.grid.set(key, []);
            }
            this.grid.get(key).push(index);
        }
    }

    /**
     * Get a shallow copy of features for a specific range (used for streaming saves)
     * @param {number} start - Inclusive start index
     * @param {number} end - Exclusive end index
     * @returns {Array} Array of feature objects
     */
    getFeatureRange(start, end) {
        if (start < 0 || end > this.allFeatures.length || start > end) {
            console.warn(`getFeatureRange called with invalid bounds [${start}, ${end})`);
            return [];
        }
        return this.allFeatures.slice(start, end);
    }

    /**
     * Serialize to plain object for IndexedDB storage
     * Chunk boundaries define how features are grouped (by shapefile)
     * @param {Array} chunkBoundaries - Array of chunk boundaries {start, end, shapefileName}
     */
    serialize(chunkBoundaries) {
        if (!chunkBoundaries || chunkBoundaries.length === 0) {
            throw new Error('serialize() requires chunkBoundaries parameter');
        }

        // Convert Map to plain object with array values
        const gridObject = {};
        for (const [key, indices] of this.grid.entries()) {
            gridObject[key] = indices;
        }

        // Build chunk metadata: map grid cells to chunk IDs based on shapefile boundaries
        this.initializeChunkLookup(chunkBoundaries);

        const chunkMetadata = this.buildChunkMetadata();

        // Store chunk boundaries on the instance for immediate use
        this.chunkBoundaries = chunkBoundaries;

        // Set chunk metadata on the instance so it can be used immediately
        this.setChunkMetadata(chunkMetadata);

        return {
            cellSize: this.cellSize,
            grid: gridObject,
            featureCount: this.allFeatures.length,
            chunkMetadata: chunkMetadata,
            chunkBoundaries: chunkBoundaries, // Save boundaries for variable-sized chunks
            // Features stored separately in chunks
        };
    }

    /**
     * Build chunk metadata by mapping grid cells to chunk IDs
     * @returns {Object} chunkMetadata mapping cellKey -> [chunkIds]
     */
    buildChunkMetadata() {
        const metadata = {};

        if (!this.featureToChunk) {
            console.warn('buildChunkMetadata called before featureToChunk was initialized');
            return metadata;
        }

        for (const [cellKey, indices] of this.grid.entries()) {
            const chunkSet = new Set();
            for (const index of indices) {
                if (index < this.featureToChunk.length) {
                    chunkSet.add(this.featureToChunk[index]);
                }
            }

            if (chunkSet.size > 0) {
                metadata[cellKey] = Array.from(chunkSet);
            }
        }

        console.log(`🗺️ Generated chunk metadata for ${Object.keys(metadata).length} grid cells`);
        return metadata;
    }

    /**
     * Serialize features in chunks for memory-efficient storage
     * @param {number} chunkSize - Number of features per chunk
     * @returns {Array} Array of feature chunks
     */
    serializeFeatures(chunkSize = StorageConfig.CHUNK_SIZE) {
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
        this.featureCount = data.featureCount || 0; // Restore feature count

        // Convert plain object back to Map
        this.grid.clear();
        for (const [key, indices] of Object.entries(data.grid)) {
            this.grid.set(key, indices);
        }

        if (data.chunkBoundaries) {
            this.initializeChunkLookup(data.chunkBoundaries);
            this.chunkBoundaries = data.chunkBoundaries;
        }

        // Set chunk metadata for lazy loading
        if (data.chunkMetadata) {
            this.setChunkMetadata(data.chunkMetadata);
        }

        // Features loaded separately (or on-demand in lazy mode)
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
        this.featureCount = this.allFeatures.length;
        console.log(`Loaded ${this.featureCount} features from ${chunks.length} chunks`);
    }

    /**
     * Get feature by index (handles lazy loading)
     */
    getFeature(index) {
        if (this.lazyMode) {
            const lookup = this.resolveChunkForIndex(index);
            const { chunkId, localIndex } = lookup;

            // Debug: Log first few getFeature attempts
            if (!this._getFeatureCallCount) this._getFeatureCallCount = 0;
            if (this._getFeatureCallCount < 5) {
                console.log(`📄 getFeature(${index}): chunkId = ${chunkId}, localIndex = ${localIndex}, loaded = ${this.loadedChunks.has(chunkId)} `);
                if (chunkId >= 0 && this.loadedChunks.has(chunkId)) {
                    const features = this.chunkMap.get(chunkId);
                    console.log(`  → Chunk ${chunkId} has ${features?.length || 0} features, getting index ${localIndex} `);
                }
                this._getFeatureCallCount++;
            }

            // Check if chunk is loaded
            if (chunkId >= 0 && this.loadedChunks.has(chunkId)) {
                const features = this.chunkMap.get(chunkId);
                return features ? features[localIndex] : null;
            }
            return null;
        }
        return this.allFeatures[index];
    }

    /**
     * Enable lazy loading mode
     */
    enableLazyLoading(chunkLoader, cacheOptions = null) {
        this.lazyMode = true;
        this.chunkLoader = chunkLoader;
        console.log('Lazy loading enabled with chunk loader');

        if (cacheOptions) {
            const appliedLimit = this.tuneChunkCache(cacheOptions);
            console.log(`Adaptive chunk cache limit: ${appliedLimit}`);
            return appliedLimit;
        }

        return this.maxCachedChunks;
    }

    /**
     * Tune chunk cache size based on device and dataset characteristics
     * @param {Object} cacheOptions
     * @returns {number} applied cache limit
     */
    tuneChunkCache(cacheOptions) {
        const {
            deviceMemory = null,
            isMobile = false,
            isOlderiPad = false,
            chunkCount = null,
            maxCachedChunks = StorageConfig.MAX_CACHED_CHUNKS
        } = cacheOptions || {};

        let limit = typeof maxCachedChunks === 'number' && maxCachedChunks > 0
            ? Math.floor(maxCachedChunks)
            : StorageConfig.MAX_CACHED_CHUNKS;

        // Dataset-aware adjustment: avoid caching more chunks than exist
        if (typeof chunkCount === 'number' && chunkCount > 0) {
            limit = Math.min(limit, Math.max(1, chunkCount));

            // For very large datasets, use a heuristic of ~10% of chunks with sensible bounds
            const heuristic = Math.max(3, Math.min(20, Math.ceil(chunkCount * 0.1)));
            limit = Math.min(limit, heuristic);
        }

        // Device-specific reductions for constrained hardware
        if (deviceMemory !== null && !Number.isNaN(deviceMemory)) {
            if (deviceMemory <= 2) {
                limit = Math.min(limit, 4);
            } else if (deviceMemory <= 4) {
                limit = Math.min(limit, 6);
            } else if (deviceMemory >= 8) {
                // Allow a bit more headroom on high-memory desktops
                limit = Math.min(Math.max(limit, 12), chunkCount ? Math.max(12, Math.min(chunkCount, 20)) : 12);
            }
        }

        if (isOlderiPad) {
            limit = Math.min(limit, 4);
        } else if (isMobile) {
            limit = Math.min(limit, 6);
        }

        // Final clamp to valid range
        if (typeof chunkCount === 'number' && chunkCount > 0) {
            limit = Math.min(limit, chunkCount);
        }
        limit = Math.max(1, Math.min(50, limit));

        this.maxCachedChunks = limit;
        return this.maxCachedChunks;
    }

    /**
     * Ensure required chunks are loaded
     */
    async ensureChunksLoaded(chunkIds) {
        const toLoad = chunkIds.filter(id => !this.loadedChunks.has(id));

        if (toLoad.length > 0 && this.chunkLoader) {
            console.log(`🔽 Loading ${toLoad.length} chunks: [${toLoad.join(', ')}]...`);
            const chunks = await this.chunkLoader(toLoad);
            console.log(`📦 Received ${chunks.length} chunks from storage`);

            for (const { id, features } of chunks) {
                if (!features) {
                    console.warn(`⚠️ Chunk ${id} has no features!`);
                    continue;
                }
                console.log(`  ✓ Chunk ${id}: ${features.length} features loaded`);
                this.chunkMap.set(id, features);
                this.loadedChunks.add(id);
                this.updateChunkCache(id);
            }

            console.log(`✅ Chunks in memory: ${this.loadedChunks.size}, chunkMap size: ${this.chunkMap.size} `);

            // Evict old chunks if cache is full
            this.evictOldChunks();
        } else if (toLoad.length === 0) {
            console.log(`♻️ All ${chunkIds.length} chunks already loaded`);
            // Just update access time for already loaded chunks
            chunkIds.forEach(id => {
                if (this.loadedChunks.has(id)) {
                    this.updateChunkCache(id);
                }
            });
        }
    }

    /**
     * Update LRU cache
     */
    updateChunkCache(chunkId) {
        const now = Date.now();
        const existing = this.chunkCache.find(c => c.id === chunkId);

        if (existing) {
            existing.lastAccess = now;
        } else {
            this.chunkCache.push({ id: chunkId, lastAccess: now });
        }
    }

    /**
     * Evict least recently used chunks
     */
    evictOldChunks() {
        if (this.chunkCache.length <= this.maxCachedChunks) {
            return;
        }

        // Sort by last access time
        this.chunkCache.sort((a, b) => a.lastAccess - b.lastAccess);

        // Remove oldest chunks
        const toRemove = this.chunkCache.splice(0, this.chunkCache.length - this.maxCachedChunks);

        for (const { id } of toRemove) {
            this.chunkMap.delete(id);
            this.loadedChunks.delete(id);
        }

        console.log(`Evicted ${toRemove.length} chunks from cache (limit ${this.maxCachedChunks})`);
    }

    /**
     * Prefetch neighboring chunks for smooth movement
     */
    prefetchNeighboringChunks(centerKey, range) {
        if (!this.lazyMode || !this.chunkLoader) return;

        const [centerX, centerY] = this.parseCellKey(centerKey);
        const prefetchChunks = new Set();

        // Prefetch chunks in larger radius
        const prefetchRange = range + 2;

        for (let dx = -prefetchRange; dx <= prefetchRange; dx++) {
            for (let dy = -prefetchRange; dy <= prefetchRange; dy++) {
                const checkKey = `${centerX + dx},${centerY + dy}`;
                const chunkIds = this.getChunksForCell(checkKey);
                chunkIds
                    .filter(id => !this.loadedChunks.has(id))
                    .forEach(id => prefetchChunks.add(id));
            }
        }

        // Load in background (don't await)
        if (prefetchChunks.size > 0) {
            this.ensureChunksLoaded(Array.from(prefetchChunks)).catch(err => {
                console.warn('Prefetch failed:', err);
            });
        }
    }

    /**
     * Set chunk metadata for lazy loading
     */
    setChunkMetadata(chunkMetadata) {
        const entries = chunkMetadata instanceof Map ? chunkMetadata.entries() : Object.entries(chunkMetadata || {});
        this.chunkMetadata = new Map();

        for (const [key, value] of entries) {
            if (Array.isArray(value)) {
                this.chunkMetadata.set(key, value);
            } else if (value !== undefined && value !== null) {
                this.chunkMetadata.set(key, [value]);
            }
        }

        console.log(`Chunk metadata loaded: ${this.chunkMetadata.size} grid cells mapped to chunks`);
    }

    /**
     * Build or rebuild quick lookup tables for chunk boundaries
     */
    initializeChunkLookup(chunkBoundaries) {
        if (!chunkBoundaries || chunkBoundaries.length === 0) {
            this.featureToChunk = null;
            this._lastChunkLookup = { chunkId: -1, start: -1, end: -1 };
            return;
        }

        const totalFeatures = chunkBoundaries.reduce((max, boundary) => Math.max(max, boundary.end), 0);
        if (totalFeatures > this.featureCount) {
            this.featureCount = totalFeatures;
        }
        this.featureToChunk = new Uint32Array(totalFeatures);

        chunkBoundaries.forEach(({ start, end }, chunkId) => {
            for (let i = start; i < end; i++) {
                this.featureToChunk[i] = chunkId;
            }
        });

        this._lastChunkLookup = { chunkId: -1, start: -1, end: -1 };
    }

    /**
     * Resolve chunk information for a feature index using lookup cache
     */
    resolveChunkForIndex(index) {
        if (this._lastChunkLookup.chunkId >= 0 && index >= this._lastChunkLookup.start && index < this._lastChunkLookup.end) {
            const { chunkId, start } = this._lastChunkLookup;
            return { chunkId, localIndex: index - start };
        }

        let chunkId = -1;
        let localIndex = -1;

        if (this.featureToChunk && index < this.featureToChunk.length) {
            chunkId = this.featureToChunk[index];
            const boundary = this.chunkBoundaries[chunkId];
            if (boundary) {
                this._lastChunkLookup = { chunkId, start: boundary.start, end: boundary.end };
                localIndex = index - boundary.start;
            } else {
                chunkId = -1;
                localIndex = -1;
            }
        } else if (this.chunkBoundaries && this.chunkBoundaries.length > 0) {
            for (let i = 0; i < this.chunkBoundaries.length; i++) {
                const { start, end } = this.chunkBoundaries[i];
                if (index >= start && index < end) {
                    chunkId = i;
                    localIndex = index - start;
                    this._lastChunkLookup = { chunkId, start, end };
                    break;
                }
            }
        } else {
            const chunkSize = StorageConfig.CHUNK_SIZE;
            chunkId = Math.floor(index / chunkSize);
            const start = chunkId * chunkSize;
            const end = start + chunkSize;
            localIndex = index - start;
            this._lastChunkLookup = { chunkId, start, end };
        }

        return { chunkId, localIndex };
    }

    /**
     * Get chunk IDs mapped to a given cell key
     */
    getChunksForCell(cellKey) {
        const entry = this.chunkMetadata.get(cellKey);
        if (!entry) return [];
        return Array.isArray(entry) ? entry : [entry];
    }

    /**
     * Get index metadata
     */
    getMetadata() {
        return {
            cellSize: this.cellSize,
            gridCells: this.grid.size,
            featureCount: this.allFeatures.length,
            isLoaded: this.isLoaded,
            lazyMode: this.lazyMode,
            loadedChunks: this.loadedChunks.size,
            cachedChunks: this.chunkCache.length
        };
    }
}
