(() => {
  "use strict";

  const DATA_URL = "Data/survivor_summary.json?v=2";
  const TIERS = ["faded", "nostalgia", "survivors"];
  const TIER_COLORS = {
    faded: "#78b6d2",
    nostalgia: "#e8c66c",
    survivors: "#ff765f",
  };
  const YEAR_FEATURES = {
    loudness: { label: "Loudness", unit: "dB" },
    acousticness: { label: "Acousticness", unit: "score (0–1)" },
    energy: { label: "Energy", unit: "score (0–1)" },
    valence: { label: "Valence", unit: "score (0–1)" },
    instrumentalness: { label: "Instrumentalness", unit: "score (0–1)" },
    duration_ms: { label: "Duration", unit: "minutes", convert: (value) => value / 60000 },
  };
  const COMPARISON_FEATURES = {
    loudness: { label: "Loudness", unit: "dB" },
    acousticness: { label: "Acousticness", unit: "score (0–1)" },
    energy: { label: "Energy", unit: "score (0–1)" },
    instrumentalness: { label: "Instrumentalness", unit: "score (0–1)" },
    valence: { label: "Valence", unit: "score (0–1)" },
    danceability: { label: "Danceability", unit: "score (0–1)" },
    duration_ms: { label: "Duration", unit: "minutes", convert: (value) => value / 60000 },
  };
  const SCATTER_FEATURES = {
    ...COMPARISON_FEATURES,
    popularity: { label: "Spotify popularity", unit: "score (0–100)" },
  };
  const SPOTLIGHT_FEATURES = ["acousticness", "danceability", "energy", "instrumentalness", "valence"];
  const TIER_LABELS = {
    faded: "Faded · <20",
    nostalgia: "Nostalgia · 20–55",
    survivors: "Survivors · >55",
  };
  const ERA_SHAPES = [
    { label: "Pre-1980", glyph: "◆" },
    { label: "1980s–2000s", glyph: "■" },
    { label: "2010s", glyph: "●" },
  ];
  const numberFormat = new Intl.NumberFormat("en-US");
  const $ = (selector) => document.querySelector(selector);
  let summary;
  let resizeTimer;

  function valueFor(featureMap, key, value) {
    const feature = featureMap[key];
    return feature && feature.convert ? feature.convert(value) : value;
  }

  function formatValue(featureMap, key, value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const numeric = valueFor(featureMap, key, value);
    if (key === "loudness") return `${numeric.toFixed(1)} dB`;
    if (key === "duration_ms") return `${numeric.toFixed(2)} min`;
    if (key === "popularity") return `${Math.round(numeric)} / 100`;
    if (key === "year") return `${Math.round(numeric)}`;
    return numeric.toFixed(2);
  }

  function formatAxisValue(featureMap, key, value) {
    if (key === "duration_ms") return `${value.toFixed(1)}`;
    if (key === "loudness") return value.toFixed(1);
    if (key === "popularity" || key === "year") return `${Math.round(value)}`;
    return value.toFixed(2);
  }

  function tierFor(popularity) {
    if (popularity < 20) return "faded";
    if (popularity <= 55) return "nostalgia";
    return "survivors";
  }

  function xScaleDomain(values) {
    const extent = d3.extent(values.filter(Number.isFinite));
    if (!Number.isFinite(extent[0]) || !Number.isFinite(extent[1])) return [0, 1];
    if (extent[0] === extent[1]) {
      const padding = Math.abs(extent[0] * 0.08) || 1;
      return [extent[0] - padding, extent[1] + padding];
    }
    return extent;
  }

  function showTooltip(event, titleText, detailText) {
    const tooltip = $("#scatter-tooltip");
    const title = document.createElement("strong");
    title.textContent = titleText;
    const details = document.createElement("span");
    details.textContent = detailText;
    tooltip.replaceChildren(title, details);
    tooltip.classList.add("is-visible");
    const pointerX = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : window.innerWidth / 2;
    const pointerY = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : window.innerHeight / 2;
    const left = Math.max(12, Math.min(pointerX + 14, window.innerWidth - 335));
    const top = Math.max(12, Math.min(pointerY + 14, window.innerHeight - 190));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    $("#scatter-tooltip").classList.remove("is-visible");
  }

  function addAxes(plot, x, y, innerWidth, innerHeight, options = {}) {
    const xTicks = options.xTicks || 7;
    const yTicks = options.yTicks || 5;
    plot.append("g")
      .attr("class", "grid-line axis")
      .call(d3.axisLeft(y).ticks(yTicks).tickSize(-innerWidth).tickFormat(""))
      .call((group) => group.select(".domain").remove());
    plot.append("g")
      .attr("class", "grid-line axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(xTicks).tickSize(-innerHeight).tickFormat(""))
      .call((group) => group.select(".domain").remove());
    plot.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(xTicks).tickSizeOuter(0));
    plot.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).ticks(yTicks).tickSizeOuter(0));
  }

  function renderTierLegend() {
    $("#tier-legend").innerHTML = TIERS.map((tier) => `
      <span class="legend-item"><i class="legend-area" style="background:${TIER_COLORS[tier]}"></i>${TIER_LABELS[tier]}</span>
    `).join("");
  }

  function renderTierChart() {
    const svg = d3.select("#tier-chart");
    const element = svg.node();
    const width = element.getBoundingClientRect().width;
    const height = element.getBoundingClientRect().height;
    if (!width || !height) return;

    const isMobile = width < 540;
    const margin = { top: 18, right: 16, bottom: isMobile ? 57 : 61, left: isMobile ? 47 : 58 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const rows = summary.yearly_tiers.filter((row) => row.counts.total > 0);
    const x = d3.scaleLinear().domain([1921, 2020]).range([0, innerWidth]);
    const y = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]);
    const layers = d3.stack().keys(TIERS)
      .value((row, key) => row.counts[key] / row.counts.total)(rows);
    const root = svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
    root.selectAll("*").remove();
    const plot = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    plot.append("g")
      .attr("class", "grid-line axis")
      .call(d3.axisLeft(y).tickValues([0, .25, .5, .75, 1]).tickSize(-innerWidth).tickFormat(""))
      .call((group) => group.select(".domain").remove());
    plot.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(isMobile ? 5 : 8).tickFormat(d3.format("d")).tickSizeOuter(0));
    plot.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).tickValues([0, .25, .5, .75, 1]).tickFormat(d3.format(".0%")).tickSizeOuter(0));
    plot.append("text")
      .attr("class", "axis-title")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", isMobile ? -37 : -46)
      .attr("text-anchor", "middle")
      .text("SHARE OF TRACKS");

    const area = d3.area()
      .x((point) => x(point.data.year))
      .y0((point) => y(point[0]))
      .y1((point) => y(point[1]))
      .curve(d3.curveMonotoneX);
    plot.selectAll(".tier-area")
      .data(layers)
      .join("path")
      .attr("class", (layer) => `tier-area area-${layer.key}`)
      .attr("d", area);

    const tooltipLayer = plot.append("g").attr("class", "year-hover-layer");
    const bisect = d3.bisector((row) => row.year).center;
    tooltipLayer.append("rect")
      .attr("class", "year-hit")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("tabindex", 0)
      .attr("aria-label", "Explore yearly popularity-tier shares. Use pointer movement across the chart.")
      .on("pointermove focus", (event) => {
        const [pointerX] = d3.pointer(event, plot.node());
        const year = x.invert(pointerX);
        const row = rows[bisect(rows, year)];
        if (!row) return;
        const counts = row.counts;
        showTooltip(
          event,
          `${row.year} · ${numberFormat.format(counts.total)} tracks`,
          `Survivors (>55): ${numberFormat.format(counts.survivors)}\nNostalgia (20–55): ${numberFormat.format(counts.nostalgia)}\nFaded (<20): ${numberFormat.format(counts.faded)}`,
        );
      })
      .on("pointerleave blur", hideTooltip);
  }

  function renderYearFeatures() {
    const container = d3.select("#feature-multiples");
    const keys = Object.keys(YEAR_FEATURES);
    const cards = container.selectAll(".feature-multiple")
      .data(keys, (key) => key)
      .join((enter) => {
        const card = enter.append("section").attr("class", "feature-multiple");
        card.append("h4").attr("class", "feature-multiple-title");
        card.append("svg").attr("class", "feature-multiple-chart").attr("role", "img");
        return card;
      });

    cards.each(function (key) {
      const card = d3.select(this);
      const feature = YEAR_FEATURES[key];
      card.select(".feature-multiple-title").text(`${feature.label} · ${feature.unit}`);
      const svg = card.select("svg")
        .attr("aria-label", `Yearly mean ${feature.label.toLowerCase()} from 1921 to 2020`);
      const element = svg.node();
      const width = element.getBoundingClientRect().width;
      const height = element.getBoundingClientRect().height;
      if (!width || !height) return;

      const margin = { top: 10, right: 10, bottom: 28, left: 47 };
      const innerWidth = Math.max(20, width - margin.left - margin.right);
      const innerHeight = Math.max(24, height - margin.top - margin.bottom);
      const rows = summary.yearly_tiers.filter((row) => row.averages[key] !== null);
      const values = rows.map((row) => valueFor(YEAR_FEATURES, key, row.averages[key]));
      const domain = xScaleDomain(values);
      const padding = (domain[1] - domain[0]) * .04;
      const x = d3.scaleLinear().domain([1921, 2020]).range([0, innerWidth]);
      const y = d3.scaleLinear().domain([domain[0] - padding, domain[1] + padding]).nice(3).range([innerHeight, 0]);
      const root = svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
      root.selectAll("*").remove();
      const plot = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

      plot.append("g")
        .attr("class", "grid-line axis")
        .call(d3.axisLeft(y).ticks(3).tickSize(-innerWidth).tickFormat(""))
        .call((group) => group.select(".domain").remove());
      plot.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(width < 360 ? 3 : 4).tickFormat(d3.format("d")).tickSizeOuter(0));
      plot.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(y).ticks(3).tickFormat((value) => formatAxisValue(YEAR_FEATURES, key, value)).tickSizeOuter(0));

      const line = d3.line()
        .x((row) => x(row.year))
        .y((row) => y(valueFor(YEAR_FEATURES, key, row.averages[key])))
        .curve(d3.curveMonotoneX);
      plot.append("path").datum(rows).attr("class", "feature-line").attr("d", line);
      plot.selectAll(".feature-point")
        .data(rows)
        .join("circle")
        .attr("class", "feature-point")
        .attr("cx", (row) => x(row.year))
        .attr("cy", (row) => y(valueFor(YEAR_FEATURES, key, row.averages[key])))
        .attr("r", 2.5)
        .attr("tabindex", 0)
        .attr("aria-label", (row) => `${row.year}: ${formatValue(YEAR_FEATURES, key, row.averages[key])}; ${numberFormat.format(row.counts.total)} tracks`)
        .on("pointerenter focus", (event, row) => showTooltip(
          event,
          `${row.year} · ${feature.label}`,
          `Yearly mean: ${formatValue(YEAR_FEATURES, key, row.averages[key])}\nTracks in dataset: ${numberFormat.format(row.counts.total)}\nSurvivors: ${numberFormat.format(row.counts.survivors)}`,
        ))
        .on("pointerleave blur", hideTooltip);
    });
  }

  function renderDecadeLegend() {
    $("#decade-legend").innerHTML = `
      <span class="legend-item"><i class="legend-dot faded-dot"></i>FADED · <20</span>
      <span class="legend-item"><i class="legend-dot survivor-dot"></i>SURVIVORS · >55</span>
      <span class="legend-item">Labels show tracks per tier</span>
    `;
  }

  function renderDecadeChart() {
    const svg = d3.select("#decade-chart");
    const element = svg.node();
    const width = element.getBoundingClientRect().width;
    const height = element.getBoundingClientRect().height;
    if (!width || !height) return;

    const key = $("#comparison-feature").value;
    const feature = COMPARISON_FEATURES[key];
    const isMobile = width < 540;
    const margin = { top: 24, right: isMobile ? 105 : 132, bottom: 56, left: isMobile ? 64 : 82 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const rows = summary.decade_comparison.filter((row) => row.faded.count && row.survivors.count);
    const values = rows.flatMap((row) => [
      valueFor(COMPARISON_FEATURES, key, row.faded.means[key]),
      valueFor(COMPARISON_FEATURES, key, row.survivors.means[key]),
    ]);
    const domain = xScaleDomain(values);
    const padding = (domain[1] - domain[0]) * .08;
    const x = d3.scaleLinear().domain([domain[0] - padding, domain[1] + padding]).nice(5).range([0, innerWidth]);
    const y = d3.scaleBand().domain(rows.map((row) => row.decade)).range([0, innerHeight]).padding(.42);
    const root = svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
    root.selectAll("*").remove();
    const plot = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    plot.append("g")
      .attr("class", "grid-line axis")
      .call(d3.axisBottom(x).ticks(6).tickSize(innerHeight).tickFormat(""))
      .call((group) => group.select(".domain").remove());
    plot.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((value) => formatAxisValue(COMPARISON_FEATURES, key, value)).tickSizeOuter(0));
    plot.append("g")
      .attr("class", "axis")
      .call(d3.axisLeft(y).tickSize(0))
      .call((group) => group.select(".domain").remove());
    plot.append("text")
      .attr("class", "axis-title")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 48)
      .attr("text-anchor", "middle")
      .text(`${feature.label.toUpperCase()} · ${feature.unit.toUpperCase()}`);

    const rowGroup = plot.selectAll(".decade-row")
      .data(rows)
      .join("g")
      .attr("class", "decade-row")
      .attr("transform", (row) => `translate(0,${y(row.decade) + y.bandwidth() / 2})`);
    rowGroup.append("line")
      .attr("class", "dumbbell-line")
      .attr("x1", (row) => x(valueFor(COMPARISON_FEATURES, key, row.faded.means[key])))
      .attr("x2", (row) => x(valueFor(COMPARISON_FEATURES, key, row.survivors.means[key])))
      .attr("y1", 0)
      .attr("y2", 0);
    rowGroup.append("circle")
      .attr("class", "dumbbell-faded")
      .attr("cx", (row) => x(valueFor(COMPARISON_FEATURES, key, row.faded.means[key])))
      .attr("r", 7)
      .attr("tabindex", 0)
      .attr("aria-label", (row) => `${row.decade} faded mean ${formatValue(COMPARISON_FEATURES, key, row.faded.means[key])}, ${row.faded.count} tracks`)
      .on("pointerenter focus", (event, row) => showTooltip(
        event,
        `${row.decade} · faded`,
        `Mean ${feature.label.toLowerCase()}: ${formatValue(COMPARISON_FEATURES, key, row.faded.means[key])}\nTracks in group: ${numberFormat.format(row.faded.count)}`,
      ))
      .on("pointerleave blur", hideTooltip);
    rowGroup.append("circle")
      .attr("class", "dumbbell-survivor")
      .attr("cx", (row) => x(valueFor(COMPARISON_FEATURES, key, row.survivors.means[key])))
      .attr("r", 7)
      .attr("tabindex", 0)
      .attr("aria-label", (row) => `${row.decade} survivor mean ${formatValue(COMPARISON_FEATURES, key, row.survivors.means[key])}, ${row.survivors.count} tracks`)
      .on("pointerenter focus", (event, row) => showTooltip(
        event,
        `${row.decade} · survivors`,
        `Mean ${feature.label.toLowerCase()}: ${formatValue(COMPARISON_FEATURES, key, row.survivors.means[key])}\nTracks in group: ${numberFormat.format(row.survivors.count)}`,
      ))
      .on("pointerleave blur", hideTooltip);
    rowGroup.append("text")
      .attr("class", "row-count")
      .attr("x", innerWidth + 12)
      .attr("y", 4)
      .text((row) => `n ${numberFormat.format(row.faded.count)} / ${numberFormat.format(row.survivors.count)}`);
  }

  function initializeScatterControls() {
    const options = Object.entries(SCATTER_FEATURES)
      .map(([key, feature]) => `<option value="${key}">${feature.label}</option>`)
      .join("");
    $("#scatter-x").innerHTML = options;
    $("#scatter-y").innerHTML = options;
    $("#scatter-x").value = "energy";
    $("#scatter-y").value = "loudness";
    $("#scatter-legend").innerHTML = [
      ...TIERS.map((tier) => `
        <span class="legend-item"><i class="legend-swatch" style="background:${TIER_COLORS[tier]}"></i>${TIER_LABELS[tier]}</span>
      `),
      ...ERA_SHAPES.map((era) => `
        <span class="legend-item era-legend"><b>${era.glyph}</b>${era.label}</span>
      `),
    ].join("");
  }

  function filterScatterSample() {
    const era = $("#scatter-era").value;
    const tier = $("#scatter-tier").value;
    return summary.scatter_sample.filter((track) => {
      const eraMatch = era === "all" ||
        (era === "survivor-compare" && (track.year < 1980 || (track.year >= 2010 && track.year <= 2019))) ||
        (era === "pre-1980" && track.year < 1980) ||
        (era === "1980-1999" && track.year >= 1980 && track.year <= 1999) ||
        (era === "2000-2009" && track.year >= 2000 && track.year <= 2009) ||
        (era === "2010-2019" && track.year >= 2010 && track.year <= 2019);
      return eraMatch && (tier === "all" || tierFor(track.popularity) === tier);
    });
  }

  function renderScatterChart() {
    const svg = d3.select("#scatter-chart");
    const element = svg.node();
    const width = element.getBoundingClientRect().width;
    const height = element.getBoundingClientRect().height;
    if (!width || !height) return;

    const rows = filterScatterSample();
    const xKey = $("#scatter-x").value;
    const yKey = $("#scatter-y").value;
    const xFeature = SCATTER_FEATURES[xKey];
    const yFeature = SCATTER_FEATURES[yKey];
    const isMobile = width < 540;
    const margin = { top: 20, right: 18, bottom: isMobile ? 68 : 76, left: isMobile ? 67 : 80 };
    const innerWidth = Math.max(40, width - margin.left - margin.right);
    const innerHeight = Math.max(40, height - margin.top - margin.bottom);
    const xValues = rows.map((track) => valueFor(SCATTER_FEATURES, xKey, track[xKey]));
    const yValues = rows.map((track) => valueFor(SCATTER_FEATURES, yKey, track[yKey]));
    const xDomain = xScaleDomain(xValues);
    const yDomain = xScaleDomain(yValues);
    const xPad = (xDomain[1] - xDomain[0]) * .05;
    const yPad = (yDomain[1] - yDomain[0]) * .05;
    const x = d3.scaleLinear().domain([xDomain[0] - xPad, xDomain[1] + xPad]).nice(5).range([0, innerWidth]);
    const y = d3.scaleLinear().domain([yDomain[0] - yPad, yDomain[1] + yPad]).nice(5).range([innerHeight, 0]);
    const root = svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
    root.selectAll("*").remove();
    const plot = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    addAxes(plot, x, y, innerWidth, innerHeight, { xTicks: isMobile ? 4 : 6, yTicks: 5 });
    plot.append("text")
      .attr("class", "axis-title")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + (isMobile ? 58 : 65))
      .attr("text-anchor", "middle")
      .text(`${xFeature.label.toUpperCase()} · ${xFeature.unit.toUpperCase()}`);
    plot.append("text")
      .attr("class", "axis-title")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", isMobile ? -53 : -63)
      .attr("text-anchor", "middle")
      .text(`${yFeature.label.toUpperCase()} · ${yFeature.unit.toUpperCase()}`);

    if (!rows.length) {
      plot.append("text")
        .attr("class", "scatter-empty")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight / 2)
        .attr("text-anchor", "middle")
        .text("No sampled tracks match these filters.");
    } else {
      plot.selectAll(".point")
        .data(rows, (track) => track.id)
        .join("path")
        .attr("class", "point")
        .attr("d", (track) => {
          const shape = track.year < 1980 ? d3.symbolDiamond :
            track.year < 2010 ? d3.symbolSquare : d3.symbolCircle;
          return d3.symbol().type(shape).size(rows.length > 300 ? 65 : 90)();
        })
        .attr("transform", (track) => `translate(${x(valueFor(SCATTER_FEATURES, xKey, track[xKey]))},${y(valueFor(SCATTER_FEATURES, yKey, track[yKey]))})`)
        .attr("fill", (track) => TIER_COLORS[tierFor(track.popularity)])
        .attr("tabindex", 0)
        .attr("aria-label", (track) =>
          `${track.name} by ${track.artists.join(", ")}, ${track.year}. Popularity ${track.popularity}. ${xFeature.label} ${formatValue(SCATTER_FEATURES, xKey, track[xKey])}; ${yFeature.label} ${formatValue(SCATTER_FEATURES, yKey, track[yKey])}.`,
        )
        .on("pointerenter focus", (event, track) => showTooltip(
          event,
          track.name,
          `${track.artists.join(", ")}\n${track.year} · ${track.decade} · Popularity ${track.popularity}\n${xFeature.label}: ${formatValue(SCATTER_FEATURES, xKey, track[xKey])}\n${yFeature.label}: ${formatValue(SCATTER_FEATURES, yKey, track[yKey])}`,
        ))
        .on("pointerleave blur", hideTooltip);
    }
    const era = $("#scatter-era").selectedOptions[0].textContent;
    const tier = $("#scatter-tier").value;
    const tierLabel = tier === "all" ? "all tiers" : TIER_LABELS[tier].toLowerCase();
    $("#scatter-title").textContent = `${yFeature.label} vs. ${xFeature.label}`;
    $("#scatter-count").textContent = `${rows.length} sampled tracks · ${era.toLowerCase()} · ${tierLabel}`;
  }

  function initializeGenreInspector() {
    const select = $("#spotlight-genre");
    select.replaceChildren(...summary.genre_inspector.genres.map((genre) =>
      new Option(`${genre.name} · ${numberFormat.format(genre.track_count)} tracks`, genre.name),
    ));
    updateInspectorTracks();
  }

  function updateInspectorTracks() {
    const genreName = $("#spotlight-genre").value;
    const genre = summary.genre_inspector.genres.find((item) => item.name === genreName);
    if (!genre) return;
    const threshold = Number($("#popularity-threshold").value);
    $("#popularity-value").textContent = `${threshold}+`;
    const available = summary.genre_inspector.tracks
      .filter((track) => track.genres.includes(genreName) && track.popularity >= threshold)
      .sort((a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name));
    const select = $("#spotlight-select");
    select.replaceChildren(...available.map((track) =>
      new Option(`${track.name} — ${track.artists.join(", ")} (${track.year} · ${track.popularity})`, track.id),
    ));
    select.disabled = available.length === 0;
    $("#spotlight-filter-note").textContent =
      `${numberFormat.format(available.length)} sampled tracks meet ${threshold}+ · genre median uses all ${numberFormat.format(genre.track_count)} matched tracks.`;
    if (!available.length) {
      select.replaceChildren(new Option("No sampled tracks at this threshold", ""));
      $("#spotlight-year").textContent = "—";
      $("#spotlight-popularity").textContent = "—";
      $("#spotlight-genre-label").textContent = genreName;
      $("#spotlight-track-title").textContent = "No tracks at this threshold";
      $("#spotlight-artist").textContent = "";
      $("#spotlight-copy").textContent = "Lower the popularity threshold to explore tracks in this artist genre.";
      $("#spotlight-scale-note").textContent = "";
      $("#spotlight-ring-key").replaceChildren();
      d3.select("#spotlight-chart").selectAll("*").remove();
      hideTooltip();
      return;
    }
    select.value = available[0].id;
    renderSpotlight();
  }

  function renderSpotlight() {
    const genreName = $("#spotlight-genre").value;
    const genre = summary.genre_inspector.genres.find((item) => item.name === genreName);
    const track = summary.genre_inspector.tracks.find((item) =>
      item.id === $("#spotlight-select").value && item.genres.includes(genreName),
    );
    if (!genre || !track) return;
    $("#spotlight-year").textContent = track.year;
    $("#spotlight-popularity").textContent = `${track.popularity} / 100`;
    $("#spotlight-genre-label").textContent = genreName;
    $("#spotlight-track-title").textContent = track.name;
    $("#spotlight-artist").textContent = track.artists.join(", ");
    const energyDelta = track.energy - genre.medians.energy;
    const acousticDelta = track.acousticness - genre.medians.acousticness;
    const direction = (value) => value >= 0 ? "above" : "below";
    $("#spotlight-copy").textContent =
      `Energy is ${Math.abs(energyDelta).toFixed(2)} ${direction(energyDelta)} the ${genreName} median; acousticness is ${Math.abs(acousticDelta).toFixed(2)} ${direction(acousticDelta)}. The median covers ${numberFormat.format(genre.track_count)} tracks and is not changed by the popularity filter.`;
    $("#spotlight-scale-note").textContent =
      `Outside the ring · Loudness: ${formatValue(COMPARISON_FEATURES, "loudness", track.loudness)} vs. ${formatValue(COMPARISON_FEATURES, "loudness", genre.medians.loudness)} genre median · Duration: ${formatValue(COMPARISON_FEATURES, "duration_ms", track.duration_ms)} vs. ${formatValue(COMPARISON_FEATURES, "duration_ms", genre.medians.duration_ms)} genre median.`;
    renderSpotlightChart(track, genre);
  }

  function renderSpotlightChart(track, genre) {
    const svg = d3.select("#spotlight-chart");
    const element = svg.node();
    const width = element.getBoundingClientRect().width;
    const height = element.getBoundingClientRect().height;
    if (!width || !height) return;
    const root = svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
    root.selectAll("*").remove();
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.43;
    const innerRadius = radius * 0.34;
    const bandWidth = (radius - innerRadius) / SPOTLIGHT_FEATURES.length;
    const medians = genre.medians;
    const arc = d3.arc();
    const fullArc = d3.arc().startAngle(0).endAngle(2 * Math.PI);
    const translated = root.append("g").attr("transform", `translate(${centerX},${centerY})`);

    svg.attr("aria-label", `Concentric sound rings for ${track.name} compared with the ${genre.name} artist-genre median`);
    root.append("desc").text(`Five concentric rings compare acousticness, danceability, energy, instrumentalness, and valence for ${track.name} and the median for ${genre.name}, based on ${numberFormat.format(genre.track_count)} matched tracks.`);

    SPOTLIGHT_FEATURES.forEach((key, index) => {
      const feature = COMPARISON_FEATURES[key];
      const trackValue = track[key];
      const medianValue = medians[key];
      const outerEdge = radius - index * bandWidth - 1;
      const innerEdge = radius - (index + 1) * bandWidth + 1;
      const laneGap = 1.5;
      const laneWidth = (outerEdge - innerEdge - laneGap) / 2;
      const trackOuter = outerEdge;
      const trackInner = outerEdge - laneWidth;
      const medianOuter = innerEdge + laneWidth;
      const medianInner = innerEdge;
      const group = translated.append("g").attr("class", "sound-ring-feature");
      const currentValueFor = (series) => series === "track" ? trackValue : medianValue;
      const drawArc = (outerRadius, innerRadius, value) => arc
        .innerRadius(innerRadius)
        .outerRadius(outerRadius)
        .startAngle(0)
        .endAngle(2 * Math.PI * Math.max(0, Math.min(1, value)))();
      const drawLane = (series, value, outerRadius, innerRadius) => {
        group.append("path")
          .attr("class", `sound-ring-arc sound-ring-arc-${series}`)
          .attr("d", fullArc.innerRadius(innerRadius).outerRadius(outerRadius)())
          .attr("aria-hidden", "true");
        group.append("path")
          .attr("class", `sound-ring-arc sound-ring-arc-${series} sound-ring-progress`)
          .attr("d", drawArc(outerRadius, innerRadius, value))
          .attr("tabindex", 0)
          .attr("aria-label", `${series === "track" ? track.name : `${genre.name} median`} ${feature.label}: ${formatValue(COMPARISON_FEATURES, key, currentValueFor(series))}`)
          .on("pointerenter focus", (event) => showTooltip(
            event,
            `${feature.label} · ${series === "track" ? track.name : `${genre.name} median`}`,
            `Track: ${formatValue(COMPARISON_FEATURES, key, trackValue)}\n${genre.name} median: ${formatValue(COMPARISON_FEATURES, key, medianValue)}`,
          ))
          .on("pointerleave blur", hideTooltip);
      };
      drawLane("track", trackValue, trackOuter, trackInner);
      drawLane("median", medianValue, medianOuter, medianInner);
    });

    root.append("circle")
      .attr("class", "sound-ring-center")
      .attr("cx", centerX)
      .attr("cy", centerY)
      .attr("r", innerRadius * 0.87);
    root.append("text")
      .attr("class", "sound-ring-center-label")
      .attr("x", centerX)
      .attr("y", centerY - 3)
      .attr("text-anchor", "middle")
      .text("SOUND");
    root.append("text")
      .attr("class", "sound-ring-center-label sound-ring-center-subtitle")
      .attr("x", centerX)
      .attr("y", centerY + 12)
      .attr("text-anchor", "middle")
      .text("RING");

    $("#spotlight-ring-key").innerHTML = SPOTLIGHT_FEATURES.map((key) => `
      <div class="sound-ring-key-item">
        <span>${COMPARISON_FEATURES[key].label}</span>
        <span class="sound-ring-key-values"><b>${track[key].toFixed(2)}</b><i>/</i><span>${medians[key].toFixed(2)}</span></span>
      </div>
    `).join("");
  }

  function bindControls() {
    $("#open-attribute-guide").addEventListener("click", () => {
      $("#attribute-guide-dialog").showModal();
    });
    $("#comparison-feature").addEventListener("change", renderDecadeChart);
    ["#scatter-x", "#scatter-y", "#scatter-era", "#scatter-tier"].forEach((selector) => {
      $(selector).addEventListener("change", renderScatterChart);
    });
    $("#spotlight-genre").addEventListener("change", updateInspectorTracks);
    $("#popularity-threshold").addEventListener("input", updateInspectorTracks);
    $("#spotlight-select").addEventListener("change", renderSpotlight);
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderAll, 140);
    });
    if ("IntersectionObserver" in window) {
      const links = [...document.querySelectorAll(".chapter-nav a")];
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((link) => link.classList.toggle("is-active", link.hash === `#${entry.target.id}`));
        });
      }, { rootMargin: "-30% 0px -60% 0px" });
      document.querySelectorAll(".chapter[id]").forEach((section) => observer.observe(section));
    }
  }

  function renderAll() {
    renderTierChart();
    renderYearFeatures();
    renderDecadeChart();
    renderScatterChart();
    if ($("#spotlight-select").value) renderSpotlight();
  }

  async function init() {
    try {
      summary = await d3.json(DATA_URL);
      if (!summary.yearly_tiers?.length || !summary.decade_comparison?.length ||
          !summary.scatter_sample?.length || !summary.genre_inspector?.genres?.length ||
          !summary.genre_inspector?.tracks?.length) {
        throw new Error("The survivor summary is missing one or more required sections.");
      }
      $("#dataset-summary").textContent =
        `${numberFormat.format(summary.metadata.track_count)} tracks · ${summary.metadata.year_range[0]}–${summary.metadata.year_range[1]}`;
      renderTierLegend();
      renderDecadeLegend();
      initializeScatterControls();
      initializeGenreInspector();
      bindControls();
      renderAll();
      $("#page-status").classList.add("is-hidden");
    } catch (error) {
      console.error("Could not load Data/survivor_summary.json:", error);
      $("#page-status").textContent = "Could not load Data/survivor_summary.json. Serve this folder over HTTP and check the Data path.";
      $("#page-status").classList.add("is-error");
    }
  }

  if (typeof d3 === "undefined") {
    $("#page-status").textContent = "D3.js could not be loaded. Check your internet connection and reload.";
    $("#page-status").classList.add("is-error");
  } else {
    init();
  }
})();