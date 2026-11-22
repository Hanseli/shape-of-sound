(() => {
  "use strict";

  const DATA_URL = "Data/survivor_summary.json";
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
  const SPOTLIGHT_FEATURES = Object.keys(COMPARISON_FEATURES);
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

  function initializeSpotlights() {
    const select = $("#spotlight-select");
    select.replaceChildren(...summary.curated_spotlights.map((track) =>
      new Option(`${track.year} · ${track.name} — ${track.artists.join(", ")}`, track.id),
    ));
    renderSpotlight();
  }

  function renderSpotlight() {
    const track = summary.curated_spotlights.find((item) => item.id === $("#spotlight-select").value);
    if (!track) return;
    $("#spotlight-decade").textContent = `${track.year} · ${track.decade}`;
    $("#spotlight-popularity").textContent = `${track.popularity} / 100`;
    $("#spotlight-track-title").textContent = track.name;
    $("#spotlight-artist").textContent = track.artists.join(", ");
    const baseline = track.birth_decade_baseline;
    const energyDelta = track.energy - baseline.averages.energy;
    const acousticDelta = track.acousticness - baseline.averages.acousticness;
    const direction = (value) => value >= 0 ? "above" : "below";
    $("#spotlight-copy").textContent =
      `This track's energy is ${Math.abs(energyDelta).toFixed(2)} ${direction(energyDelta)} its decade mean; acousticness is ${Math.abs(acousticDelta).toFixed(2)} ${direction(acousticDelta)}. The baseline averages ${numberFormat.format(baseline.track_count)} tracks from the ${baseline.decade}.`;
    renderSpotlightChart(track);
  }

  function renderSpotlightChart(track) {
    const svg = d3.select("#spotlight-chart");
    const element = svg.node();
    const width = element.getBoundingClientRect().width;
    const height = element.getBoundingClientRect().height;
    if (!width || !height) return;
    const isMobile = width < 540;
    const margin = { top: 18, right: isMobile ? 128 : 190, bottom: 18, left: isMobile ? 120 : 160 };
    const innerWidth = Math.max(35, width - margin.left - margin.right);
    const rowHeight = Math.min(48, (height - margin.top - margin.bottom) / SPOTLIGHT_FEATURES.length);
    const root = svg.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMidYMid meet");
    root.selectAll("*").remove();
    const plot = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    SPOTLIGHT_FEATURES.forEach((key, index) => {
      const feature = COMPARISON_FEATURES[key];
      const baselineValue = track.birth_decade_baseline.averages[key];
      const trackValue = track[key];
      const extents = d3.extent(summary.curated_spotlights.flatMap((item) => [
        item[key],
        item.birth_decade_baseline.averages[key],
      ]));
      const span = extents[1] - extents[0] || Math.max(Math.abs(extents[0]) * .1, 1);
      const scale = d3.scaleLinear()
        .domain([extents[0] - span * .12, extents[1] + span * .12])
        .range([0, innerWidth]);
      const centerY = index * rowHeight + rowHeight / 2;
      const xTrack = scale(trackValue);
      const xBaseline = scale(baselineValue);
      plot.append("line")
        .attr("class", "spotlight-line")
        .attr("x1", xTrack)
        .attr("x2", xBaseline)
        .attr("y1", centerY)
        .attr("y2", centerY);
      plot.append("circle")
        .attr("class", "spotlight-track")
        .attr("cx", xTrack)
        .attr("cy", centerY)
        .attr("r", 6)
        .attr("tabindex", 0)
        .attr("aria-label", `${track.name}: ${feature.label} ${formatValue(COMPARISON_FEATURES, key, trackValue)}`)
        .on("pointerenter focus", (event) => showTooltip(
          event,
          `${track.name} · ${feature.label}`,
          `Track: ${formatValue(COMPARISON_FEATURES, key, trackValue)}\n${track.birth_decade_baseline.decade} mean: ${formatValue(COMPARISON_FEATURES, key, baselineValue)}`,
        ))
        .on("pointerleave blur", hideTooltip);
      plot.append("circle")
        .attr("class", "spotlight-baseline")
        .attr("cx", xBaseline)
        .attr("cy", centerY)
        .attr("r", 6)
        .attr("tabindex", 0)
        .attr("aria-label", `${track.birth_decade_baseline.decade} mean ${feature.label} ${formatValue(COMPARISON_FEATURES, key, baselineValue)}`)
        .on("pointerenter focus", (event) => showTooltip(
          event,
          `${track.birth_decade_baseline.decade} mean · ${feature.label}`,
          `${numberFormat.format(track.birth_decade_baseline.track_count)} tracks\nMean: ${formatValue(COMPARISON_FEATURES, key, baselineValue)}`,
        ))
        .on("pointerleave blur", hideTooltip);
      plot.append("text")
        .attr("class", "spotlight-feature")
        .attr("x", -12)
        .attr("y", centerY + 4)
        .attr("text-anchor", "end")
        .text(feature.label);
      plot.append("text")
        .attr("class", "spotlight-values")
        .attr("x", innerWidth + 12)
        .attr("y", centerY + 4)
        .text(`${formatValue(COMPARISON_FEATURES, key, trackValue)} / ${formatValue(COMPARISON_FEATURES, key, baselineValue)}`);
    });
    root.append("text")
      .attr("class", "spotlight-values")
      .attr("x", width - 8)
      .attr("y", height - 4)
      .attr("text-anchor", "end")
      .text("TRACK / DECADE MEAN · EACH ROW HAS ITS OWN SCALE");
  }

  function bindControls() {
    $("#comparison-feature").addEventListener("change", renderDecadeChart);
    ["#scatter-x", "#scatter-y", "#scatter-era", "#scatter-tier"].forEach((selector) => {
      $(selector).addEventListener("change", renderScatterChart);
    });
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
          !summary.scatter_sample?.length || !summary.curated_spotlights?.length) {
        throw new Error("The survivor summary is missing one or more required sections.");
      }
      $("#dataset-summary").textContent =
        `${numberFormat.format(summary.metadata.track_count)} tracks · ${summary.metadata.year_range[0]}–${summary.metadata.year_range[1]}`;
      renderTierLegend();
      renderDecadeLegend();
      initializeScatterControls();
      initializeSpotlights();
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