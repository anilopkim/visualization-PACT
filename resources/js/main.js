document.addEventListener('DOMContentLoaded', () => {
    // Wait for Neutralino to be ready
    Neutralino.init();
    Neutralino.events.on('ready', () => {
        // Confirm JS is running by changing the page title
        try {
            document.title = 'JS Loaded!';
        } catch (e) {}

        // Canvas setup for custom map rendering
        const canvas = document.getElementById('map-canvas');
        const ctx = canvas.getContext('2d');

        function resizeCanvasToDisplaySize() {
            const container = canvas.parentElement;
            // Set canvas size to match its container
            const width = container.clientWidth;
            const height = container.clientHeight;
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
        }

        // Resize on window resize and before drawing
        window.addEventListener('resize', () => {
            resizeCanvasToDisplaySize();
            requestDrawMap();
        });

        // Simple equirectangular projection
        function project([lon, lat]) {
            // Map lon/lat to canvas coordinates
            const x = ((lon + 180) / 360) * canvas.width;
            const y = ((90 - lat) / 180) * canvas.height;
            return [x, y];
        }

        // Function to parse CSV (simple version)
        function parseCSV(text) {
            const lines = text.trim().split('\n');
            const headers = lines[0].split(',');
            return lines.slice(1).map(line => {
                const values = line.split(',');
                let obj = {};
                headers.forEach((header, i) => {
                    obj[header.trim()] = values[i] ? values[i].trim() : '';
                });
                return obj;
            });
        }



        let csvData = [];
        let countries = [];
        let selectedCountryIndex = null;
        let mapBounds = null;
        let zoom = 1;
        let panX = 0;
        let panY = 0;
        let isPanning = false;
        let startPan = { x: 0, y: 0 };
        let lastPan = { x: 0, y: 0 };
        let redrawPending = false;

        function requestDrawMap() {
            if (!redrawPending) {
                redrawPending = true;
                window.requestAnimationFrame(() => {
                    drawMap();
                    redrawPending = false;
                });
            }
        }

        // Initial resize to match display size
        resizeCanvasToDisplaySize();
        Neutralino.filesystem.readFile('data/geography_data.csv').then(resp => {
            csvData = parseCSV(resp.data);
            loadCountriesGeoJSON();
            requestDrawMap();
        }).catch(err => {
            loadCountriesGeoJSON();
            requestDrawMap();
        });

        function getGeoBounds(features) {
            let minX = 180, minY = 90, maxX = -180, maxY = -90;
            features.forEach(feature => {
                const geom = feature.geometry;
                const polys = (geom.type === 'Polygon') ? [geom.coordinates] : geom.coordinates;
                polys.forEach(poly => {
                    poly.forEach(ring => {
                        ring.forEach(([lon, lat]) => {
                            if (lon < minX) minX = lon;
                            if (lon > maxX) maxX = lon;
                            if (lat < minY) minY = lat;
                            if (lat > maxY) maxY = lat;
                        });
                    });
                });
            });
            return {minX, minY, maxX, maxY};
        }

        function projectFit([lon, lat]) {
            if (!mapBounds) return [0, 0];
            const {minX, minY, maxX, maxY} = mapBounds;
            const mapWidth = maxX - minX;
            const mapHeight = maxY - minY;
            // Maintain world aspect ratio (2:1 for equirectangular)
            const aspect = 2.0; // width:height
            let drawWidth = canvas.width, drawHeight = canvas.height;
            if (canvas.width / canvas.height > aspect) {
                drawWidth = canvas.height * aspect;
            } else {
                drawHeight = canvas.width / aspect;
            }
            const scale = Math.min(drawWidth / mapWidth, drawHeight / mapHeight) * 0.95 * zoom;
            const x = ((lon - minX) * scale) + (canvas.width - mapWidth * scale) / 2 + panX;
            const y = ((maxY - lat) * scale) + (canvas.height - mapHeight * scale) / 2 + panY;
            return [x, y];
        }

        // Helper: get map lon/lat from canvas x/y
        function screenToMapCoords(x, y) {
            if (!mapBounds) return [0, 0];
            const {minX, minY, maxX, maxY} = mapBounds;
            const mapWidth = maxX - minX;
            const mapHeight = maxY - minY;
            const aspect = 2.0;
            let drawWidth = canvas.width, drawHeight = canvas.height;
            if (canvas.width / canvas.height > aspect) {
                drawWidth = canvas.height * aspect;
            } else {
                drawHeight = canvas.width / aspect;
            }
            const scale = Math.min(drawWidth / mapWidth, drawHeight / mapHeight) * 0.95 * zoom;
            const offsetX = (canvas.width - mapWidth * scale) / 2 + panX;
            const offsetY = (canvas.height - mapHeight * scale) / 2 + panY;
            const lon = (x - offsetX) / scale + minX;
            const lat = maxY - (y - offsetY) / scale;
            return [lon, lat];
        }

        function loadCountriesGeoJSON() {
            const path = 'resources/countries.geojson';
            console.log('[GeoJSON] Trying to read from path:', path);
            Neutralino.filesystem.readFile(path).then(resp => {
                console.log('[GeoJSON] Read response:', resp);
                let geojson;
                try {
                    geojson = JSON.parse(resp);
                    console.log('[GeoJSON] JSON parsed successfully.');
                } catch (e) {
                    console.error('[GeoJSON] JSON parse error:', e);
                    return;
                }
                if (!geojson || typeof geojson !== 'object') {
                    console.error('[GeoJSON] Parsed geojson is not an object:', geojson);
                    return;
                }
                console.log('[GeoJSON] Parsed object keys:', Object.keys(geojson));
                if (!geojson.features) {
                    console.error('[GeoJSON] geojson.features is missing:', geojson);
                    return;
                }
                console.log('[GeoJSON] geojson.features:', geojson.features);
                console.log('[GeoJSON] geojson.features type:', typeof geojson.features, 'length:', geojson.features.length);
                countries = geojson.features;
                mapBounds = getGeoBounds(countries);
                if (!countries.length) {
                    console.error('[GeoJSON] geojson.features is empty:', geojson.features);
                }
                drawMap();
            }).catch(err => {
                console.error('[GeoJSON] Failed to load from', path, err);
            });
        }

        function drawMap() {
            resizeCanvasToDisplaySize();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
            // Navigraph-style dark ocean background
            ctx.fillStyle = '#1a2332';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Draw countries
            countries.forEach((feature, idx) => {
                ctx.save();
                ctx.beginPath();
                const geom = feature.geometry;
                if (geom.type === 'Polygon') {
                    drawPolygonFit(geom.coordinates);
                } else if (geom.type === 'MultiPolygon') {
                    geom.coordinates.forEach(poly => drawPolygonFit(poly));
                }
                ctx.fillStyle = (idx === selectedCountryIndex) ? '#38bdf8' : '#232b3e';
                ctx.globalAlpha = (idx === selectedCountryIndex) ? 0.8 : 0.7;
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.1;
                ctx.shadowColor = (idx === selectedCountryIndex) ? '#38bdf8' : 'rgba(0,0,0,0.2)';
                ctx.shadowBlur = (idx === selectedCountryIndex) ? 8 : 2;
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            });

            // Draw crosshair at center of canvas
            //ctx.save();
            //ctx.strokeStyle = '#ff4f4f';
            //ctx.lineWidth = 2;
            //const cx = canvas.width / 2;
            //const cy = canvas.height / 2;
            //ctx.beginPath();
            //ctx.moveTo(cx - 10, cy);
            //ctx.lineTo(cx + 10, cy);
            //ctx.moveTo(cx, cy - 10);
            //ctx.lineTo(cx, cy + 10);
            //ctx.stroke();
            //ctx.restore();
        }

        function drawPolygonFit(coords) {
            coords.forEach(ring => {
                ring.forEach(([lon, lat], i) => {
                    const [x, y] = projectFit([lon, lat]);
                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }
                });
                if (ring.length > 0) {
                    const [x0, y0] = projectFit(ring[0]);
                    ctx.lineTo(x0, y0);
                }
            });
        }

        canvas.addEventListener('click', function(e) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            let found = false;
            countries.forEach((feature, idx) => {
                ctx.save();
                ctx.beginPath();
                const geom = feature.geometry;
                if (geom.type === 'Polygon') {
                    drawPolygonFit(geom.coordinates);
                } else if (geom.type === 'MultiPolygon') {
                    geom.coordinates.forEach(poly => drawPolygonFit(poly));
                }
                if (ctx.isPointInPath(x, y)) {
                    selectedCountryIndex = idx;
                    found = true;
                }
                ctx.restore();
            });
            if (!found) selectedCountryIndex = null;
            drawMap();
            // Show selected country name
            const selectedDiv = document.getElementById('selected-country');
            if (selectedCountryIndex !== null && countries[selectedCountryIndex]) {
                selectedDiv.textContent = 'Selected: ' + (countries[selectedCountryIndex].properties.name || 'Unknown');
            } else {
                selectedDiv.textContent = '';
            }
        });

        canvas.addEventListener('wheel', function(e) {
            e.preventDefault();
            const zoomIntensity = 0.1;
            // Get map coordinates under the center of the canvas before zoom
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const [centerLon, centerLat] = screenToMapCoords(centerX, centerY);
            const prevZoom = zoom;
            if (e.deltaY < 0) {
                zoom *= 1 + zoomIntensity;
            } else {
                zoom /= 1 + zoomIntensity;
            }
            zoom = Math.max(zoom, 0.5);
            zoom = Math.min(zoom, 10);
            // After zoom, calculate new pan so the same map point stays at the center
            // Recalculate scale and offset for new zoom
            const {minX, minY, maxY, maxX} = mapBounds;
            const mapWidth = maxX - minX;
            const mapHeight = maxY - minY;
            const aspect = 2.0;
            let drawWidth = canvas.width, drawHeight = canvas.height;
            if (canvas.width / canvas.height > aspect) {
                drawWidth = canvas.height * aspect;
            } else {
                drawHeight = canvas.width / aspect;
            }
            const scale = Math.min(drawWidth / mapWidth, drawHeight / mapHeight) * 0.95 * zoom;
            // Calculate what panX/panY are needed to keep centerLon/centerLat at center
            panX = centerX - ((centerLon - minX) * scale + (canvas.width - mapWidth * scale) / 2);
            panY = centerY - ((maxY - centerLat) * scale + (canvas.height - mapHeight * scale) / 2);
            requestDrawMap();
        }, { passive: false });

        canvas.addEventListener('mousedown', function(e) {
            isPanning = true;
            startPan = { x: e.clientX, y: e.clientY };
            lastPan = { x: panX, y: panY };
        });
        window.addEventListener('mousemove', function(e) {
            if (!isPanning) return;
            panX = lastPan.x + (e.clientX - startPan.x);
            panY = lastPan.y + (e.clientY - startPan.y);
            requestDrawMap();
        });
        window.addEventListener('mouseup', function() {
            isPanning = false;
        });

        // Reset zoom and pan on double click
        canvas.addEventListener('dblclick', function() {
            zoom = 1;
            panX = 0;
            panY = 0;
            requestDrawMap();
        });

        document.getElementById('reset-map-btn').addEventListener('click', function() {
            zoom = 1;
            panX = 0;
            panY = 0;
            requestDrawMap();
        });
    });
});
