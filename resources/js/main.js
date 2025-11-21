document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');

    if (typeof d3 === 'undefined') {
        console.error('CRITICAL: D3.js is not loaded!');
        alert('Error: D3.js library not found.');
        return;
    } else {
        console.log('D3.js loaded, version:', d3.version);
    }

    // Wait for Neutralino to be ready
    try {
        Neutralino.init();
        console.log('Neutralino initialized');
    } catch (e) {
        console.error('Neutralino init failed:', e);
    }

    Neutralino.events.on('ready', () => {
        console.log('Neutralino ready event fired');
        try {
            document.title = 'World Happiness Map';
        } catch (e) { }

        const canvas = document.getElementById('map-canvas');
        if (!canvas) {
            console.error('Canvas element not found!');
            return;
        }
        console.log('Canvas found, size:', canvas.clientWidth, 'x', canvas.clientHeight);

        const context = canvas.getContext('2d');

        // State
        let width = canvas.clientWidth;
        let height = canvas.clientHeight;
        let countries = [];
        let economyData = {};
        let demographicsData = {};
        let commData = {};
        let energyData = {};
        let transData = {};
        let selectedCountry = null;
        let hoveredCountry = null;
        let transform = d3.zoomIdentity;

        // D3 Projection
        const projection = d3.geoEqualEarth()
            .scale(width / 1.8 / Math.PI)
            .translate([width / 2, height / 2]);

        const path = d3.geoPath()
            .projection(projection)
            .context(context);

        let redrawPending = false;
        function requestDraw() {
            if (!redrawPending) {
                redrawPending = true;
                requestAnimationFrame(() => {
                    draw();
                    redrawPending = false;
                });
            }
        }

        // Resize handler
        function resize() {
            width = canvas.parentElement.clientWidth;
            height = canvas.parentElement.clientHeight;
            canvas.width = width;
            canvas.height = height;

            // Update projection to fit new size
            projection
                .scale(width / 1.8 / Math.PI)
                .translate([width / 2, height / 2]);

            requestDraw();
        }
        window.addEventListener('resize', resize);
        resize();

        // Data Loading
        // Data Loading
        // 1. Load Map Data (Critical)
        Neutralino.filesystem.readFile('resources/countries.geojson')
            .then(data => {
                const geojson = JSON.parse(data);
                countries = geojson.features;
                console.log('Map data loaded:', countries.length, 'countries');
                requestDraw();

                // 2. Load Attribute Data (Non-critical for map rendering)
                loadAttributeData();
            })
            .catch(err => {
                console.error('Error loading map data:', err);
                Neutralino.os.showMessageBox('Error', 'Failed to load map data: ' + err.message, 'ERROR');
            });

        function loadAttributeData() {
            Promise.all([
                Neutralino.filesystem.readFile('data/economy_data.csv').then(data => d3.csvParse(data)),
                Neutralino.filesystem.readFile('data/demographics_data.csv').then(data => d3.csvParse(data)),
                Neutralino.filesystem.readFile('data/communications_data.csv').then(data => d3.csvParse(data)),
                Neutralino.filesystem.readFile('data/energy_data.csv').then(data => d3.csvParse(data)),
                Neutralino.filesystem.readFile('data/transportation_data.csv').then(data => d3.csvParse(data))
            ]).then(([economy, demographics, communications, energy, transportation]) => {
                // Process Economy Data
                economy.forEach(d => {
                    economyData[d.Country.toUpperCase()] = d;
                });

                // Process Demographics Data
                demographics.forEach(d => {
                    demographicsData[d.Country.toUpperCase()] = d;
                });

                // Process Communications Data
                communications.forEach(d => {
                    commData[d.Country.toUpperCase()] = d;
                });

                // Process Energy Data
                energy.forEach(d => {
                    energyData[d.Country.toUpperCase()] = d;
                });

                // Process Transportation Data
                transportation.forEach(d => {
                    transData[d.Country.toUpperCase()] = d;
                });

                console.log('Attribute data loaded');
            }).catch(err => {
                console.error('Error loading attribute data:', err);
                Neutralino.os.showMessageBox('Warning', 'Failed to load some attribute data. The map will still work, but details may be missing.', 'WARNING');
            });
        }

        // Drawing
        function draw() {
            context.save();
            context.clearRect(0, 0, width, height);

            // Background (Ocean)
            context.fillStyle = '#0f172a';
            context.fillRect(0, 0, width, height);

            context.beginPath();
            path({ type: "Sphere" });
            context.fillStyle = '#1e293b';
            context.fill();

            context.save();
            // Apply Zoom Transform
            context.translate(transform.x, transform.y);
            context.scale(transform.k, transform.k);

            // Draw Countries
            countries.forEach(feature => {
                context.beginPath();
                path(feature);

                const isSelected = selectedCountry && selectedCountry === feature;
                const isHovered = hoveredCountry && hoveredCountry === feature;

                if (isSelected) {
                    context.fillStyle = '#38bdf8';
                    context.globalAlpha = 0.9;
                } else if (isHovered) {
                    context.fillStyle = '#475569';
                    context.globalAlpha = 1;
                } else {
                    context.fillStyle = '#334155';
                    context.globalAlpha = 1;
                }

                context.fill();

                context.strokeStyle = '#475569';
                context.lineWidth = 0.5 / transform.k;
                if (isSelected || isHovered) {
                    context.strokeStyle = '#94a3b8';
                    context.lineWidth = 1 / transform.k;
                }
                context.stroke();
            });

            context.restore();
            context.restore();
        }



        // Zoom Behavior
        const zoom = d3.zoom()
            .scaleExtent([1, 8])
            .on('zoom', (event) => {
                transform = event.transform;
                requestDraw();
            });

        d3.select(canvas)
            .call(zoom)
            .on('dblclick.zoom', null); // Disable double click zoom

        // Mouse Move (Hover)
        d3.select(canvas).on('mousemove', (event) => {
            const [x, y] = d3.pointer(event);
            const invertedX = (x - transform.x) / transform.k;
            const invertedY = (y - transform.y) / transform.k;
            const [lon, lat] = projection.invert([invertedX, invertedY]);

            const found = countries.find(feature => d3.geoContains(feature, [lon, lat]));

            if (found !== hoveredCountry) {
                hoveredCountry = found;
                requestDraw();
                canvas.style.cursor = found ? 'pointer' : 'default';
            }
        });

        // Click Handling
        d3.select(canvas).on('click', (event) => {
            const [x, y] = d3.pointer(event);

            // Inverse transform to get map coordinates
            const invertedX = (x - transform.x) / transform.k;
            const invertedY = (y - transform.y) / transform.k;
            const [lon, lat] = projection.invert([invertedX, invertedY]);

            // Find clicked country
            let clicked = hoveredCountry;
            if (!clicked) {
                clicked = countries.find(feature => d3.geoContains(feature, [lon, lat]));
            }

            if (clicked) {
                selectedCountry = clicked;
                requestDraw();
                openPopup(clicked);
            } else {
                selectedCountry = null;
                requestDraw();
            }
        });

        document.getElementById('reset-map-btn').addEventListener('click', () => {
            d3.select(canvas).transition().duration(750).call(zoom.transform, d3.zoomIdentity);
        });

        // Popup Logic
        const modal = document.getElementById('country-modal');
        const closeBtn = document.getElementById('close-modal');

        function openPopup(feature) {
            const name = feature.properties.name || feature.properties.ADMIN || 'Unknown Country';
            const nameUpper = name.toUpperCase();

            const eco = economyData[nameUpper] || {};
            const demo = demographicsData[nameUpper] || {};

            // Calculate Happiness Index (Mock Logic)
            // Based on GDP per capita and Infant Mortality (inverse)
            let happiness = 5.0; // Default
            let gdp = parseFloat(eco.Real_GDP_per_Capita_USD || 0);
            let mortality = parseFloat(demo.Infant_Mortality_Rate || 0);

            if (gdp > 0) {
                // Log scale for GDP: 0 to 100k -> 0 to 1
                const gdpScore = Math.min(Math.log10(gdp) / 5, 1) * 10;
                // Mortality: 100 to 0 -> 0 to 1
                const mortScore = Math.max(0, (100 - mortality) / 10);

                happiness = (gdpScore * 0.6 + mortScore * 0.4).toFixed(1);
            } else {
                happiness = (Math.random() * 4 + 3).toFixed(1); // Random 3-7 if no data
            }

            // Update UI
            document.getElementById('modal-country-name').textContent = name;
            document.getElementById('modal-happiness-val').textContent = happiness;
            document.getElementById('modal-overview-text').textContent =
                `${name} has a population of ${formatNumber(demo.Total_Population)} and a GDP per capita of $${formatNumber(eco.Real_GDP_per_Capita_USD)}.`;

            document.getElementById('modal-gdp').textContent = eco.Real_GDP_PPP_billion_USD ? `$${eco.Real_GDP_PPP_billion_USD} B` : 'N/A';
            document.getElementById('modal-population').textContent = demo.Total_Population ? formatNumber(demo.Total_Population) : 'N/A';
            document.getElementById('modal-area').textContent = feature.properties.pop_est ? 'N/A' : 'N/A'; // GeoJSON might not have area

            modal.style.display = 'flex';
            // Small delay to allow display:flex to apply before opacity transition
            setTimeout(() => {
                modal.classList.add('active');
                // Draw charts after modal is visible and has dimensions
                drawCharts(feature);
            }, 10);
        }

        function closePopup() {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        }

        closeBtn.addEventListener('click', closePopup);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closePopup();
        });

        function drawCharts(feature) {
            const name = feature.properties.name || feature.properties.ADMIN || 'Unknown Country';
            const nameUpper = name.toUpperCase();

            const eco = economyData[nameUpper] || {};
            const demo = demographicsData[nameUpper] || {};
            const comm = commData[nameUpper] || {};
            const energy = energyData[nameUpper] || {};

            // --- Radar Data ---
            let literacy = parseFloat((demo.Total_Literacy_Rate || '0').replace('%', '')) || 0;
            let electricity = parseFloat(energy.electricity_access_percent) || 0;

            let population = parseFloat(demo.Total_Population) || 1;
            let internetUsers = parseFloat(comm.internet_users_total) || 0;
            let internet = (internetUsers / population) * 100;
            if (internet > 100) internet = 100;

            let mobileSubs = parseFloat(comm.mobile_cellular_subscriptions_total) || 0;
            let mobile = (mobileSubs / population) * 100;
            if (mobile > 100) mobile = 100;

            let mortality = parseFloat(demo.Infant_Mortality_Rate) || 0;
            let health = Math.max(0, 100 - mortality);

            const radarData = [
                { axis: "Literacy", value: literacy },
                { axis: "Electricity", value: electricity },
                { axis: "Internet", value: internet },
                { axis: "Mobile", value: mobile },
                { axis: "Health", value: health }
            ];

            drawRadarChart("#chart-radar", radarData);

            // --- Bar Data ---
            const gdp = parseFloat(eco.Real_GDP_per_Capita_USD) || 0;
            const unemployment = parseFloat(eco.Unemployment_Rate_percent) || 0;
            const debt = parseFloat(eco.Public_Debt_percent_of_GDP) || 0;

            const barData = [
                { label: "GDP/Cap", value: gdp, max: 100000, format: v => `$${(v / 1000).toFixed(1)}k` },
                { label: "Unemployment", value: unemployment, max: 20, format: v => `${v}%` },
                { label: "Public Debt", value: debt, max: 150, format: v => `${v}%` }
            ];

            drawBarChart("#chart-bar", barData);
        }

        function drawRadarChart(selector, data) {
            const container = d3.select(selector);
            container.selectAll("*").remove();

            const width = container.node().clientWidth;
            const height = container.node().clientHeight;
            const margin = 30;
            const radius = Math.min(width, height) / 2 - margin;

            const svg = container.append("svg")
                .attr("width", width)
                .attr("height", height)
                .append("g")
                .attr("transform", `translate(${width / 2},${height / 2})`);

            const rScale = d3.scaleLinear().range([0, radius]).domain([0, 100]);
            const angleSlice = Math.PI * 2 / data.length;

            // Draw Grid
            const levels = 5;
            for (let i = 0; i < levels; i++) {
                const levelFactor = radius * ((i + 1) / levels);
                svg.selectAll(".levels")
                    .data([1]) // dummy data
                    .enter()
                    .append("circle")
                    .attr("class", "radar-grid")
                    .attr("r", levelFactor)
                    .style("fill", "none")
                    .style("stroke", "#475569")
                    .style("stroke-opacity", "0.5");
            }

            // Draw Axes
            const axes = svg.selectAll(".axis")
                .data(data)
                .enter()
                .append("g")
                .attr("class", "radar-axis");

            axes.append("line")
                .attr("x1", 0)
                .attr("y1", 0)
                .attr("x2", (d, i) => rScale(100) * Math.cos(angleSlice * i - Math.PI / 2))
                .attr("y2", (d, i) => rScale(100) * Math.sin(angleSlice * i - Math.PI / 2))
                .style("stroke", "#475569")
                .style("stroke-width", "1px");

            axes.append("text")
                .attr("class", "legend")
                .style("font-size", "11px")
                .attr("text-anchor", "middle")
                .attr("dy", "0.35em")
                .attr("x", (d, i) => rScale(115) * Math.cos(angleSlice * i - Math.PI / 2))
                .attr("y", (d, i) => rScale(115) * Math.sin(angleSlice * i - Math.PI / 2))
                .text(d => d.axis);

            // Draw Blob
            const radarLine = d3.lineRadial()
                .curve(d3.curveLinearClosed)
                .radius(d => rScale(d.value))
                .angle((d, i) => i * angleSlice);

            svg.append("path")
                .datum(data)
                .attr("class", "radar-area")
                .attr("d", radarLine)
                .style("fill", "rgba(56, 189, 248, 0.5)")
                .style("stroke", "#38bdf8")
                .style("stroke-width", 2);
        }

        function drawBarChart(selector, data) {
            const container = d3.select(selector);
            container.selectAll("*").remove();

            const width = container.node().clientWidth;
            const height = container.node().clientHeight;
            const margin = { top: 20, right: 10, bottom: 30, left: 10 };
            const chartWidth = width - margin.left - margin.right;
            const chartHeight = height - margin.top - margin.bottom;

            const svg = container.append("svg")
                .attr("width", width)
                .attr("height", height)
                .append("g")
                .attr("transform", `translate(${margin.left},${margin.top})`);

            const x = d3.scaleBand()
                .range([0, chartWidth])
                .domain(data.map(d => d.label))
                .padding(0.4);

            svg.selectAll(".bar")
                .data(data)
                .enter()
                .append("rect")
                .attr("class", "bar-rect")
                .attr("x", d => x(d.label))
                .attr("width", x.bandwidth())
                .attr("y", d => {
                    const pct = Math.min(d.value / d.max, 1);
                    return chartHeight - (chartHeight * pct);
                })
                .attr("height", d => {
                    const pct = Math.min(d.value / d.max, 1);
                    return Math.max(chartHeight * pct, 2); // Min height 2px
                })
                .attr("rx", 4);

            // Labels
            svg.selectAll(".label")
                .data(data)
                .enter()
                .append("text")
                .attr("class", "chart-axis")
                .attr("x", d => x(d.label) + x.bandwidth() / 2)
                .attr("y", chartHeight + 15)
                .attr("text-anchor", "middle")
                .text(d => d.label);

            // Values
            svg.selectAll(".value")
                .data(data)
                .enter()
                .append("text")
                .attr("class", "chart-axis")
                .attr("x", d => x(d.label) + x.bandwidth() / 2)
                .attr("y", d => {
                    const pct = Math.min(d.value / d.max, 1);
                    return chartHeight - (chartHeight * pct) - 5;
                })
                .attr("text-anchor", "middle")
                .style("fill", "#fff")
                .text(d => d.format(d.value));
        }

        function formatNumber(num) {
            if (!num) return '--';
            return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(num);
        }
    });
});
