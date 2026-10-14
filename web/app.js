"use strict";

const API_KEY = window.APP_CONFIG.googleMapsApiKey;
const MAP_ID = "DEMO_MAP_ID";
const SJAELLAND_CENTER = { lat: 55.45, lng: 11.8 };

// Facility types from udinaturen.dk, grouped for the picker.
const FACILITY_GROUPS = [
  ["Praktisk", [
    ["P-plads", "🅿️"], ["Toilet", "🚻"], ["Vandpost", "🚰"], ["Borde-Bænke", "🪑", "Borde/bænke"],
    ["Madpakkehus", "🛖"], ["Information", "ℹ️"], ["Cykelservice", "🚲"],
  ]],
  ["Overnatning og bål", [
    ["Shelter på primitiv overnatningsplads", "⛺", "Shelter"], ["Primitiv overnatningsplads", "🏕️"],
    ["Lejrplads", "🏕️"], ["Frit teltningsområde", "⛺"], ["Bålplads", "🔥"], ["Bålhytte", "🪵"],
  ]],
  ["Udsigt og oplevelser", [
    ["Udsigtstårn", "🗼"], ["Udsigtspunkt", "🔭"], ["Kulturhistorie", "🏛️"], ["Geologi", "🪨"],
    ["Planter og dyr", "🦌"], ["Rekreative naturområder", "🌳", "Naturområde"],
    ["Virtuelt oplevelsespunkt - podcast", "🎧", "Podcast"],
  ]],
  ["Aktiviteter", [
    ["Legeplads", "🛝"], ["Badested", "🏖️"], ["Badebro", "🏊"], ["Hundeskov", "🐕"],
    ["Fiskeri tilladt", "🎣"], ["Fiskeplatform", "🎣"], ["Udendørs træning", "💪"], ["Kælkebakke", "🛷"],
    ["Isætningssted", "🛶"], ["Isætningsrampe", "🛶"], ["Kano/kajak rastested", "🛶"],
  ]],
];
const FACILITY = new Map();
for (const [, items] of FACILITY_GROUPS) {
  for (const [type, emoji, label] of items) FACILITY.set(type, { emoji, label: label || type });
}
const facEmoji = (t) => FACILITY.get(t)?.emoji || "📍";
const facLabel = (t) => FACILITY.get(t)?.label || t;

const DISTANCES = [5, 10, 15, 20, 25]; // max route length options, km

const MODES = {
  car: { label: "bil", icon: "🚗", api: "DRIVE", gmaps: "driving" },
  transit: { label: "offentlig transport", icon: "🚆", api: "TRANSIT", gmaps: "transit" },
};

// ---------------------------------------------------------------------------
// State

const state = {
  routes: [],
  byId: new Map(),
  selected: new Set(load("selected", [])),
  maxKm: load("maxKm", null), // null = any length
  mode: load("mode", "car"),
  maxMinutes: load("maxMinutes", 45),
  origin: null, // { lat, lng, label }
  results: null, // [{ route, sec, m }]
  unreachable: 0,
  departureNote: "",
  view: "list",
  sort: "time",
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem("walkwithme." + key);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem("walkwithme." + key, JSON.stringify(value)); } catch {}
}

// ---------------------------------------------------------------------------
// Helpers

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = (n, d = 1) => n.toLocaleString("da-DK", { maximumFractionDigits: d });

function fmtDuration(sec) {
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} t ${m} min` : `${h} t`;
}

function fmtLength(r) {
  if (r.km == null) return null;
  if (r.kmTotal && r.kmTotal - r.km > 0.2) return `${fmtNum(r.km)}–${fmtNum(r.kmTotal)} km`;
  return `${fmtNum(r.km)} km`;
}

function haversineKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Where to navigate to: the parking nearest the route start when driving, else the start.
function destinationFor(route, mode) {
  if (mode === "car" && route.parking) return { lat: route.parking[0], lng: route.parking[1] };
  return { lat: route.start[0], lng: route.start[1] };
}

function matchesFacilities(route, selected) {
  for (const t of selected) if (!route.facilities.includes(t)) return false;
  return true;
}

// Routes without a known length are left out once a max length is chosen.
function matchesDistance(route, maxKm) {
  return maxKm == null || (route.km != null && route.km <= maxKm);
}

function matchesFilters(route, selected = state.selected, maxKm = state.maxKm) {
  return matchesDistance(route, maxKm) && matchesFacilities(route, selected);
}

// ---------------------------------------------------------------------------
// Google Maps loader (official dynamic bootstrap)

(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
  key: API_KEY, v: "weekly", language: "da", region: "DK",
});

let gmaps = null;
async function maps() {
  if (!gmaps) {
    const [base, core, marker, geometry, geocoding] = await Promise.all([
      google.maps.importLibrary("core"),
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("marker"),
      google.maps.importLibrary("geometry"),
      google.maps.importLibrary("geocoding"),
    ]);
    gmaps = { ...base, ...core, ...marker, ...geometry, ...geocoding };
  }
  return gmaps;
}

// ---------------------------------------------------------------------------
// Router

const SCREENS = ["facilities", "travel", "results", "detail"];

function show(name) {
  for (const s of SCREENS) $(`#screen-${s}`).classList.toggle("active", s === name);
}

function route() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("rute/")) {
    const r = state.byId.get(hash.slice(5));
    if (r) { renderDetail(r); show("detail"); return; }
  }
  if (hash === "ruter" && state.results) { renderResults(); show("results"); return; }
  if (hash === "rejse" || hash === "ruter") { renderTravel(); show("travel"); return; }
  renderFacilities();
  show("facilities");
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-back]")) {
    e.preventDefault();
    const screen = e.target.closest(".screen").id.replace("screen-", "");
    go({ travel: "#/", results: "#/rejse", detail: "#/ruter" }[screen]);
  }
});

// ---------------------------------------------------------------------------
// 1. Facilities

function renderDistances() {
  const chips = DISTANCES.map((km) => {
    const on = state.maxKm === km;
    const n = state.routes.filter((r) => matchesFilters(r, state.selected, km)).length;
    return `<button class="chip" aria-pressed="${on}" data-km="${km}" ${!on && !n ? "disabled" : ""}>
      Maks. ${km} km<span class="n">${on ? "" : n}</span></button>`;
  }).join("");
  $("#distance-filter").innerHTML = `<div class="group"><div class="group-title">Rutelængde</div><div class="chips">${chips}</div></div>`;
}

function renderFacilities() {
  renderDistances();
  const pool = state.routes.filter((r) => matchesDistance(r, state.maxKm));
  const known = new Set(FACILITY.keys());
  const extra = [...new Set(state.routes.flatMap((r) => r.facilities))].filter((t) => !known.has(t)).sort();
  const groups = extra.length ? [...FACILITY_GROUPS, ["Andet", extra.map((t) => [t, "📍"])]] : FACILITY_GROUPS;

  const html = groups.map(([title, items]) => {
    const chips = items
      .map(([type]) => {
        const on = state.selected.has(type);
        const trial = new Set(state.selected).add(type);
        const n = pool.filter((r) => matchesFacilities(r, trial)).length;
        const total = state.routes.filter((r) => r.facilities.includes(type)).length;
        if (!total) return "";
        return `<button class="chip" aria-pressed="${on}" data-type="${esc(type)}" ${!on && !n ? "disabled" : ""}>
          <span>${facEmoji(type)}</span>${esc(facLabel(type))}<span class="n">${on ? "" : n}</span></button>`;
      })
      .join("");
    return chips ? `<div class="group"><div class="group-title">${esc(title)}</div><div class="chips">${chips}</div></div>` : "";
  }).join("");
  $("#facility-groups").innerHTML = html;

  const count = pool.filter((r) => matchesFacilities(r, state.selected)).length;
  $("#to-travel").innerHTML = `Videre <span class="count">· ${count} ruter</span>`;
  $("#to-travel").disabled = count === 0;
  $("#clear-facilities").hidden = state.selected.size === 0 && state.maxKm == null;
}

$("#distance-filter").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip || chip.disabled) return;
  const km = Number(chip.dataset.km);
  state.maxKm = state.maxKm === km ? null : km;
  save("maxKm", state.maxKm);
  renderFacilities();
});

$("#facility-groups").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip || chip.disabled) return;
  const t = chip.dataset.type;
  state.selected.has(t) ? state.selected.delete(t) : state.selected.add(t);
  save("selected", [...state.selected]);
  renderFacilities();
});
$("#clear-facilities").addEventListener("click", () => {
  state.selected.clear();
  state.maxKm = null;
  save("selected", []);
  save("maxKm", null);
  renderFacilities();
});
$("#to-travel").addEventListener("click", () => go("#/rejse"));

// ---------------------------------------------------------------------------
// 2. Travel

function renderTravel() {
  $$(".segmented [data-mode]").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === state.mode));
  $("#max-time").value = state.maxMinutes;
  $("#max-time-value").textContent = fmtDuration(state.maxMinutes * 60);
  const chip = $("#origin-chip");
  chip.hidden = !state.origin;
  if (state.origin) chip.innerHTML = `<span>📍</span><span>${esc(state.origin.label)}</span>`;
  $("#find-routes").disabled = !state.origin;
}

$$(".segmented [data-mode]").forEach((b) =>
  b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    save("mode", state.mode);
    renderTravel();
  })
);
$("#max-time").addEventListener("input", (e) => {
  state.maxMinutes = Number(e.target.value);
  save("maxMinutes", state.maxMinutes);
  $("#max-time-value").textContent = fmtDuration(state.maxMinutes * 60);
});

function setOrigin(origin) {
  state.origin = origin;
  state.results = null;
  $("#travel-error").hidden = true;
  renderTravel();
}

function travelError(msg) {
  const el = $("#travel-error");
  el.textContent = msg;
  el.hidden = !msg;
}

$("#use-location").addEventListener("click", () => {
  if (!navigator.geolocation) return travelError("Din browser kan ikke dele placering. Skriv en adresse i stedet.");
  const btn = $("#use-location");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> Finder din placering…`;
  const reset = () => { btn.disabled = false; btn.innerHTML = `<span>📍</span> Brug min placering`; };
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setOrigin({ ...loc, label: "Din placering" });
      reset();
      try {
        const { Geocoder } = await maps();
        const { results } = await new Geocoder().geocode({ location: loc });
        if (results[0] && state.origin?.lat === loc.lat) {
          setOrigin({ ...loc, label: `Din placering · ${results[0].formatted_address.replace(/, Danmark$/, "")}` });
        }
      } catch {}
    },
    (err) => {
      reset();
      travelError(err.code === 1
        ? "Du har ikke givet adgang til din placering. Skriv en adresse i stedet."
        : "Kunne ikke finde din placering. Skriv en adresse i stedet.");
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
  );
});

// Address autocomplete via Places API (New).
let sessionToken = crypto.randomUUID();
let suggestTimer = null;
let suggestions = [];
let activeSuggestion = -1;

$("#address").addEventListener("input", (e) => {
  clearTimeout(suggestTimer);
  const q = e.target.value.trim();
  if (q.length < 2) return hideSuggestions();
  suggestTimer = setTimeout(() => fetchSuggestions(q), 220);
});
$("#address").addEventListener("keydown", (e) => {
  if ($("#suggestions").hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    activeSuggestion = (activeSuggestion + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
    $$("#suggestions li").forEach((li, i) => li.setAttribute("aria-selected", i === activeSuggestion));
  } else if (e.key === "Enter" && suggestions.length) {
    e.preventDefault();
    pickSuggestion(suggestions[Math.max(activeSuggestion, 0)]);
  } else if (e.key === "Escape") hideSuggestions();
});
$("#address").addEventListener("blur", () => setTimeout(hideSuggestions, 150));

async function fetchSuggestions(q) {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": API_KEY },
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["dk"],
        languageCode: "da",
        sessionToken,
        locationBias: { circle: { center: { latitude: SJAELLAND_CENTER.lat, longitude: SJAELLAND_CENTER.lng }, radius: 50000 } },
      }),
    });
    const data = await res.json();
    if (q !== $("#address").value.trim()) return;
    suggestions = (data.suggestions || []).map((s) => s.placePrediction).filter(Boolean);
    activeSuggestion = -1;
    const ul = $("#suggestions");
    ul.innerHTML = suggestions
      .map((p, i) => `<li role="option" data-i="${i}"><div>${esc(p.structuredFormat?.mainText?.text || p.text.text)}</div>
        <div class="sub">${esc(p.structuredFormat?.secondaryText?.text || "")}</div></li>`)
      .join("");
    ul.hidden = !suggestions.length;
  } catch {
    hideSuggestions();
  }
}

function hideSuggestions() {
  $("#suggestions").hidden = true;
  suggestions = [];
}

$("#suggestions").addEventListener("mousedown", (e) => {
  const li = e.target.closest("li");
  if (li) { e.preventDefault(); pickSuggestion(suggestions[li.dataset.i]); }
});

async function pickSuggestion(p) {
  hideSuggestions();
  const label = p.text.text.replace(/, Danmark$/, "");
  $("#address").value = label;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${p.placeId}?sessionToken=${sessionToken}`, {
      headers: { "X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": "location" },
    });
    const { location } = await res.json();
    sessionToken = crypto.randomUUID();
    if (!location) throw new Error("no location");
    setOrigin({ lat: location.latitude, lng: location.longitude, label });
    $("#address").blur();
  } catch {
    travelError("Kunne ikke finde adressen. Prøv en anden.");
  }
}

$("#find-routes").addEventListener("click", findRoutes);

// ---------------------------------------------------------------------------
// Travel times via Routes API computeRouteMatrix

const matrixCache = new Map();

function departureTime() {
  // At night public transport results are sparse, so plan for 09:00 instead.
  const now = new Date();
  if (now.getHours() >= 6 && now.getHours() < 22) return { iso: null, note: "" };
  const t = new Date(now);
  if (now.getHours() >= 22) t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return { iso: t.toISOString(), note: `Rejsetider er beregnet for afgang ${t.toLocaleDateString("da-DK", { weekday: "long" })} kl. 9.` };
}

async function travelTimes(origin, dests, mode, departureIso) {
  const out = new Array(dests.length).fill(null);
  const todo = [];
  dests.forEach((d, i) => {
    const key = [mode, origin.lat.toFixed(4), origin.lng.toFixed(4), d.lat.toFixed(5), d.lng.toFixed(5), departureIso || ""].join(",");
    if (matrixCache.has(key)) out[i] = matrixCache.get(key);
    else todo.push({ i, d, key });
  });

  const CHUNK = 100; // transit allows at most 100 elements per request
  const chunks = [];
  for (let k = 0; k < todo.length; k += CHUNK) chunks.push(todo.slice(k, k + CHUNK));

  const waypoint = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
  const runChunk = async (chunk) => {
    const body = {
      origins: [waypoint(origin)],
      destinations: chunk.map((c) => waypoint(c.d)),
      travelMode: MODES[mode].api,
    };
    if (mode === "transit" && departureIso) body.departureTime = departureIso;
    const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Routes API ${res.status}`);
    for (const el of data) {
      const c = chunk[el.destinationIndex ?? 0];
      const value = el.condition === "ROUTE_EXISTS" && el.duration
        ? { sec: parseInt(el.duration, 10), m: el.distanceMeters || 0 }
        : false;
      matrixCache.set(c.key, value);
      out[c.i] = value;
    }
  };

  // A few requests in parallel.
  const queue = [...chunks];
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) await runChunk(queue.shift());
  }));
  return out;
}

async function findRoutes() {
  if (!state.origin) return;
  const btn = $("#find-routes");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2px;border-top-color:currentColor"></span> Beregner rejsetider…`;
  travelError("");

  try {
    const { iso, note } = state.mode === "transit" ? departureTime() : { iso: null, note: "" };
    const maxSec = state.maxMinutes * 60;
    // Nothing gets further than ~130 km/h in a straight line, so skip routes that can't make it.
    const maxKm = (state.maxMinutes / 60) * 130;
    const candidates = state.routes
      .filter((r) => matchesFilters(r))
      .map((r) => ({ route: r, dest: destinationFor(r, state.mode) }))
      .filter((c) => haversineKm(state.origin, c.dest) <= maxKm);

    const times = await travelTimes(state.origin, candidates.map((c) => c.dest), state.mode, iso);
    state.unreachable = times.filter((t) => t === false).length;
    state.results = candidates
      .map((c, i) => times[i] && { route: c.route, ...times[i] })
      .filter((x) => x && x.sec <= maxSec);
    state.departureNote = note;
    state.resultsMode = state.mode;
    go("#/ruter");
  } catch (err) {
    console.error(err);
    travelError(`Kunne ikke beregne rejsetider: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Find ruter";
  }
}

// ---------------------------------------------------------------------------
// 3. Results

function sortedResults() {
  const by = {
    time: (a, b) => a.sec - b.sec,
    short: (a, b) => (a.route.km ?? 1e9) - (b.route.km ?? 1e9),
    long: (a, b) => (b.route.km ?? -1) - (a.route.km ?? -1),
    name: (a, b) => a.route.name.localeCompare(b.route.name, "da"),
  }[state.sort];
  return [...state.results].sort(by);
}

function renderResults() {
  const mode = MODES[state.resultsMode];
  const n = state.results.length;
  const facText = state.selected.size
    ? ` med ${[...state.selected].map((t) => `${facEmoji(t)} ${esc(facLabel(t).toLowerCase())}`).join(", ")}`
    : "";
  const kmText = state.maxKm != null ? ` på maks. ${state.maxKm} km` : "";
  let summary = `<b>${n} ${n === 1 ? "rute" : "ruter"}</b>${kmText} inden for ${fmtDuration(state.maxMinutes * 60)} i ${mode.label} fra ${esc(state.origin.label)}${facText}.`;
  if (state.resultsMode === "transit" && state.unreachable) {
    summary += ` ${state.unreachable} ruter kan ikke nås med offentlig transport.`;
  }
  if (state.departureNote) summary += ` ${esc(state.departureNote)}`;
  $("#results-summary").innerHTML = summary;
  $("#sort").value = state.sort;
  $$(".results-tools [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));

  const list = $("#results-list");
  const mapEl = $("#results-map");
  list.hidden = state.view !== "list";
  mapEl.hidden = state.view !== "map";

  if (!n) {
    list.hidden = false;
    mapEl.hidden = true;
    list.innerHTML = `<div class="empty"><div class="big">🌲</div>
      <p>Ingen ruter passer. Prøv en længere rejsetid, en længere rute eller færre faciliteter.</p>
      <button class="btn outline small" onclick="go('#/rejse')">Ret rejsetid</button>
      <button class="btn outline small" onclick="go('#/')">Ret længde og faciliteter</button></div>`;
    return;
  }

  if (state.view === "list") {
    list.innerHTML = `<div class="list">${sortedResults().map(cardHtml).join("")}</div>`;
  } else {
    renderResultsMap();
  }
}

function cardHtml({ route: r, sec }) {
  const mode = MODES[state.resultsMode];
  const selectedFirst = [...r.facilities].sort((a, b) => state.selected.has(b) - state.selected.has(a));
  const emojis = [...new Set(selectedFirst.map(facEmoji))].join("");
  const thumb = r.img
    ? `<img class="thumb" src="${esc(r.img.replace("/1600/", "/360/"))}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;thumb&quot;>🥾</div>'">`
    : `<div class="thumb">🥾</div>`;
  const len = fmtLength(r);
  return `<button class="card" data-id="${r.id}">
    ${thumb}
    <div class="card-body">
      <div class="card-title">${esc(r.name)}</div>
      <div class="card-org">${esc(r.org || "")}</div>
      <div class="meta"><span class="time">${mode.icon} ${fmtDuration(sec)}</span>${len ? `<span>${len}</span>` : ""}${r.marked ? "<span>Afmærket</span>" : ""}</div>
      <div class="emojis">${emojis}</div>
    </div>
  </button>`;
}

$("#results-list").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) go(`#/rute/${card.dataset.id}`);
});
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderResults(); });
$$(".results-tools [data-view]").forEach((b) =>
  b.addEventListener("click", () => { state.view = b.dataset.view; renderResults(); })
);

let resultsMap = null;
let resultsMarkers = [];

async function renderResultsMap() {
  const { Map, AdvancedMarkerElement, LatLngBounds } = await maps();
  const el = $("#results-map");
  if (!resultsMap) {
    resultsMap = new Map(el, { center: SJAELLAND_CENTER, zoom: 8, mapId: MAP_ID, disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy" });
  }
  resultsMarkers.forEach((m) => (m.map = null));
  resultsMarkers = [];
  const bounds = new LatLngBounds();

  const originPin = document.createElement("div");
  originPin.className = "pin origin";
  resultsMarkers.push(new AdvancedMarkerElement({ map: resultsMap, position: state.origin, content: originPin, title: state.origin.label }));
  bounds.extend(state.origin);

  for (const { route: r, sec } of state.results) {
    const pos = destinationFor(r, state.resultsMode);
    const pin = document.createElement("div");
    pin.className = "pin route";
    pin.textContent = fmtDuration(sec);
    const marker = new AdvancedMarkerElement({ map: resultsMap, position: pos, content: pin, title: r.name, gmpClickable: true });
    marker.addEventListener("gmp-click", () => go(`#/rute/${r.id}`));
    resultsMarkers.push(marker);
    bounds.extend(pos);
  }
  resultsMap.fitBounds(bounds, 40);
}

// ---------------------------------------------------------------------------
// 4. Detail

let detailMap = null;
let detailOverlays = [];

function renderDetail(r) {
  const result = state.results?.find((x) => x.route.id === r.id);
  const modeKey = state.resultsMode || state.mode;
  const mode = MODES[modeKey];
  const len = fmtLength(r);

  const stats = [
    ["Længde", len || "–"],
    [`Rejsetid (${mode.icon})`, result ? fmtDuration(result.sec) : "–"],
    ["Maks. stigning", r.slope != null ? `${fmtNum(r.slope)} %` : "–"],
    ["Afmærket", r.marked == null ? "–" : r.marked ? "Ja" : "Nej"],
  ];

  const hero = r.img
    ? `<img src="${esc(r.img)}" alt="" onerror="this.outerHTML='<div class=&quot;placeholder&quot;>🥾</div>'">`
    : `<div class="placeholder">🥾</div>`;

  const desc = r.desc
    ? `<div class="section"><div class="desc ${r.desc.length > 320 ? "clamped" : ""}" id="desc">${esc(r.desc)}</div>
       ${r.desc.length > 320 ? `<button class="linkbtn" id="desc-more">Læs mere</button>` : ""}</div>`
    : "";

  const facilities = r.facilities.length
    ? `<div class="section"><h2>Faciliteter</h2><div class="facility-tags">${r.facilities
        .map((t) => `<span class="tag">${facEmoji(t)} ${esc(facLabel(t))}</span>`).join("")}</div></div>`
    : "";

  const stops = r.stops.length
    ? `<div class="section"><details><summary>Undervejs på ruten</summary><ul class="stops">${r.stops
        .map((s) => `<li><span class="km">${s.km != null ? fmtNum(s.km) + " km" : ""}</span><span>${s.types
          .map((t) => `${facEmoji(t)} ${esc(facLabel(t))}`).join("<br>")}</span></li>`).join("")}</ul></details></div>`
    : "";

  const access = Object.keys(r.access).length
    ? `<div class="section"><details><summary>Tilgængelighed</summary>${Object.entries(r.access)
        .map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("")}</details></div>`
    : "";

  const gallery = r.images.length > 1
    ? `<div class="section"><h2>Billeder</h2><div class="gallery">${r.images
        .map((u) => `<img src="${esc(u.replace("/1600/", "/360/"))}" alt="" loading="lazy">`).join("")}</div></div>`
    : "";

  const ratings = r.ratings.length
    ? `<div class="section"><h2>Brugernes kommentarer</h2>${r.ratings.map((q) => `<div class="quote">${esc(q)}</div>`).join("")}</div>`
    : "";

  const links = [
    ...r.links.map((l) => [l.url, l.text || l.url]),
    ...r.videos.map((u) => [u, "▶️ Video fra ruten"]),
    r.gpx && [r.gpx, "⬇️ Download GPX-fil"],
    r.url && [r.url, "🌿 Se ruten på udinaturen.dk"],
  ].filter(Boolean);
  const linksHtml = `<div class="section links"><h2>Links</h2>${links
    .map(([u, t]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join("")}</div>`;

  const c = r.contact || {};
  const contact = `<div class="section"><h2>Ansvarlig</h2><div>${esc(c.organisation || r.org || "")}</div>
    ${c.email ? `<div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ""}
    ${c.phone ? `<div><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>` : ""}</div>`;

  $("#detail").innerHTML = `
    <div class="hero">${hero}<button class="iconbtn" data-back aria-label="Tilbage">‹</button></div>
    <div class="detail-body">
      <h1>${esc(r.name)}</h1>
      <div class="type">Vandrerute · ${esc(r.org || "")}</div>
      <div class="stats">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
      ${desc}
      <div class="section"><h2>Kort</h2><div class="detail-map" id="detail-map"></div>${elevationHtml(r)}</div>
      ${facilities}${stops}${access}${gallery}${ratings}${linksHtml}${contact}
      <p class="footnote">Data fra udinaturen.dk (Miljøstyrelsen / GeoFA).</p>
    </div>`;
  $("#detail").scrollTop = 0;

  $("#desc-more")?.addEventListener("click", (e) => {
    $("#desc").classList.remove("clamped");
    e.target.remove();
  });

  // Google Maps directions link for the chosen transport mode.
  const dest = destinationFor(r, modeKey);
  const params = new URLSearchParams({ api: "1", destination: `${dest.lat},${dest.lng}`, travelmode: mode.gmaps });
  if (state.origin) params.set("origin", `${state.origin.lat},${state.origin.lng}`);
  const btn = $("#open-gmaps");
  btn.href = `https://www.google.com/maps/dir/?${params}`;
  btn.innerHTML = `${mode.icon} Åbn i Google Maps`;
  btn.title = modeKey === "car" && r.parking ? `Kører til ${r.parking[2]}` : "Til rutens start";

  drawDetailMap(r);
}

function elevationHtml(r) {
  const e = r.elev;
  if (!e || e.length < 2) return "";
  const min = Math.min(...e), max = Math.max(...e);
  const span = Math.max(max - min, 5);
  const w = 300, h = 60;
  const pts = e.map((v, i) => `${(i / (e.length - 1)) * w},${h - 4 - ((v - min) / span) * (h - 8)}`);
  return `<div class="elev"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Højdeprofil">
      <polygon points="0,${h} ${pts.join(" ")} ${w},${h}" fill="var(--primary-soft)"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="var(--primary)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg><div class="lbl"><span>Højde ${fmtNum(min, 0)}–${fmtNum(max, 0)} m</span><span>${fmtLength(r) || ""}</span></div></div>`;
}

async function drawDetailMap(r) {
  const { Map, Polyline, AdvancedMarkerElement, InfoWindow, LatLngBounds, encoding } = await maps();
  const el = $("#detail-map");
  if (!el) return;
  // The detail markup is rebuilt per route, so the map gets a fresh container each time.
  detailMap = new Map(el, { mapId: MAP_ID, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative", center: SJAELLAND_CENTER, zoom: 9 });
  detailOverlays = [];
  const bounds = new LatLngBounds();
  const info = new InfoWindow();

  for (const enc of r.geom) {
    const path = encoding.decodePath(enc);
    path.forEach((p) => bounds.extend(p));
    detailOverlays.push(new Polyline({ map: detailMap, path, strokeColor: "#1d5a3c", strokeWeight: 4, strokeOpacity: 0.9 }));
  }

  const marker = (position, content, title, html) => {
    const m = new AdvancedMarkerElement({ map: detailMap, position, content, title, gmpClickable: !!html });
    if (html) m.addEventListener("gmp-click", () => { info.setContent(html); info.open({ map: detailMap, anchor: m }); });
    detailOverlays.push(m);
  };

  const seen = new Set();
  for (const [type, name, lat, lng] of r.points) {
    const key = `${type}|${lat}|${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pin = document.createElement("div");
    pin.className = "pin";
    pin.textContent = facEmoji(type);
    marker({ lat, lng }, pin, name, `<div class="iw"><b>${esc(name || facLabel(type))}</b>${esc(facLabel(type))}</div>`);
  }

  const start = document.createElement("div");
  start.className = "pin start";
  start.textContent = "S";
  marker({ lat: r.start[0], lng: r.start[1] }, start, "Start", `<div class="iw"><b>Start</b>${esc(r.name)}</div>`);

  detailMap.fitBounds(bounds, 24);
}

// ---------------------------------------------------------------------------
// Boot

(async function init() {
  try {
    const res = await fetch("data/routes.json");
    state.routes = await res.json();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:24px">Kunne ikke indlæse rutedata (${esc(err.message)}). Start en lokal webserver i web-mappen.</p>`;
    return;
  }
  state.byId = new Map(state.routes.map((r) => [r.id, r]));
  // Drop stored selections for facility types that no longer exist.
  const types = new Set(state.routes.flatMap((r) => r.facilities));
  state.selected = new Set([...state.selected].filter((t) => types.has(t)));
  if (!DISTANCES.includes(state.maxKm)) state.maxKm = null;
  window.addEventListener("hashchange", route);
  route();
})();
