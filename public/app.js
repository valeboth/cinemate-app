// Cinemate frontend — vanilla JS (no framework in V1).

// ── API config ─────────────────────────────────────────────────────────────
// Same-origin: the Worker serves both the static assets and /api.
const API_BASE = "";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_LOGO = "https://image.tmdb.org/t/p/w92";

function wsUrl(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

// ── Genres ──────────────────────────────────────────────────────────────────
// Full movie genre list for the quiz (niche selection).
const GENRES = [
  { id: 28, name: "Action" }, { id: 12, name: "Adventure" }, { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" }, { id: 80, name: "Crime" }, { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" }, { id: 10751, name: "Family" }, { id: 14, name: "Fantasy" },
  { id: 36, name: "History" }, { id: 27, name: "Horror" }, { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" }, { id: 10749, name: "Romance" }, { id: 878, name: "Sci-Fi" },
  { id: 53, name: "Thriller" }, { id: 10752, name: "War" }, { id: 37, name: "Western" },
];
// Full id → name map (movie ∪ tv) for card labels.
const GENRE_NAMES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
  10759: "Action & Adventure", 10762: "Kids", 10763: "News", 10764: "Reality",
  10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk", 10768: "War & Politics",
};
const LEVEL_SCORE = { 1: 0.6, 2: 1.0 };
const SWIPE_THRESHOLD = 90;

// ── App state ───────────────────────────────────────────────────────────────
const state = {
  userId: localStorage.getItem("cinemate_user_id") || null,
  username: localStorage.getItem("cinemate_username") || null,
  genreLevels: {},
  avoidGenres: new Set(),
  seeds: [], // [{ tmdb_id, media_type, title }]
  editMode: false, // editing an existing profile (vs. first-time onboarding)
  mediaType: "movie",
  room: null,
  soloMode: false,
  deck: [],
  deckIndex: 0,
  ws: null,
  pendingCode: null,
  lastSwiped: null, // { card } for undo
};

// ── API helper ──────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Screens ───────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}
const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function updateUserBadge() {
  if (state.username) {
    $("user-badge").textContent = "👤 " + state.username;
    $("user-badge").classList.remove("hidden");
  }
}

// ── Onboarding ──────────────────────────────────────────────────────────────
function renderGenreChips() {
  const box = $("genre-chips");
  box.innerHTML = "";
  GENRES.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    const paint = (level) => {
      chip.classList.toggle("like", level === 1);
      chip.classList.toggle("love", level === 2);
      chip.textContent = g.name + (level === 2 ? " ♥♥" : level === 1 ? " ♥" : "");
    };
    paint(state.genreLevels[g.id] || 0); // reflect current state (for edit prefill)
    chip.onclick = () => {
      const level = (state.genreLevels[g.id] || 0) + 1;
      if (level > 2) {
        delete state.genreLevels[g.id];
        paint(0);
      } else {
        state.genreLevels[g.id] = level;
        paint(level);
      }
    };
    box.appendChild(chip);
  });
}

// Multi-select "genres to avoid" chips (danger styling).
function renderAvoidChips() {
  const box = $("avoid-chips");
  box.innerHTML = "";
  GENRES.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = g.name;
    chip.classList.toggle("avoid", state.avoidGenres.has(g.id)); // reflect state (edit prefill)
    chip.onclick = () => {
      if (state.avoidGenres.has(g.id)) {
        state.avoidGenres.delete(g.id);
        chip.classList.remove("avoid");
      } else {
        state.avoidGenres.add(g.id);
        chip.classList.add("avoid");
      }
    };
    box.appendChild(chip);
  });
}

// Seed autocomplete: search TMDb as you type (debounced), pick titles you loved.
let seedSearchTimer = null;
function setupSeedSearch() {
  const input = $("seed-input");
  input.addEventListener("input", () => {
    clearTimeout(seedSearchTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      hideSuggestions();
      return;
    }
    seedSearchTimer = setTimeout(() => searchSeeds(q), 300);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#seed-suggestions") && e.target !== input) hideSuggestions();
  });
}

async function searchSeeds(q) {
  try {
    const res = await api(`/api/search?q=${encodeURIComponent(q)}`);
    renderSuggestions(res.results || []);
  } catch {
    hideSuggestions();
  }
}

function hideSuggestions() {
  $("seed-suggestions").classList.add("hidden");
  $("seed-suggestions").innerHTML = "";
}

function renderSuggestions(list) {
  const box = $("seed-suggestions");
  box.innerHTML = "";
  if (!list.length) {
    hideSuggestions();
    return;
  }
  list.forEach((hit) => {
    const row = document.createElement("button");
    row.className = "suggestion";
    const thumb = document.createElement("span");
    thumb.className = "sug-thumb";
    if (hit.poster_path) thumb.style.backgroundImage = `url(https://image.tmdb.org/t/p/w92${hit.poster_path})`;
    const label = document.createElement("span");
    const kind = hit.media_type === "tv" ? "TV" : "Movie";
    label.textContent = `${hit.title}${hit.year ? " (" + hit.year + ")" : ""} · ${kind}`;
    row.appendChild(thumb);
    row.appendChild(label);
    row.onclick = () => addSeed(hit);
    box.appendChild(row);
  });
  box.classList.remove("hidden");
}

function addSeed(hit) {
  if (!state.seeds.some((s) => s.tmdb_id === hit.tmdb_id && s.media_type === hit.media_type)) {
    if (state.seeds.length >= 6) {
      toast("Up to 6 titles");
    } else {
      state.seeds.push({ tmdb_id: hit.tmdb_id, media_type: hit.media_type, title: hit.title });
      renderSeedChips();
    }
  }
  $("seed-input").value = "";
  hideSuggestions();
}

function renderSeedChips() {
  const box = $("seed-chips");
  box.innerHTML = "";
  state.seeds.forEach((s) => {
    const chip = document.createElement("button");
    chip.className = "chip love";
    chip.textContent = s.title + " ✕";
    chip.title = "remove";
    chip.onclick = () => {
      state.seeds = state.seeds.filter((x) => !(x.tmdb_id === s.tmdb_id && x.media_type === s.media_type));
      renderSeedChips();
    };
    box.appendChild(chip);
  });
}

async function handleOnboarding() {
  const err = $("onboarding-error");
  err.textContent = "";
  try {
    // First-time onboarding creates the user; edit mode reuses the current one.
    if (!state.editMode) {
      const username = $("username-input").value.trim();
      if (!username) {
        err.textContent = "Please enter a name.";
        return;
      }
      const user = await api("/api/users", { method: "POST", body: JSON.stringify({ username }) });
      state.userId = user.id;
      state.username = user.username;
      localStorage.setItem("cinemate_user_id", user.id);
      localStorage.setItem("cinemate_username", user.username);
    }

    const genreScores = {};
    for (const [id, level] of Object.entries(state.genreLevels)) {
      genreScores[id] = LEVEL_SCORE[level] || 0.6;
    }
    await api("/api/profile/quiz", {
      method: "POST",
      body: JSON.stringify({
        user_id: state.userId,
        genre_scores: genreScores,
        avoid_genres: [...state.avoidGenres],
        seeds: state.seeds.map((s) => ({ tmdb_id: s.tmdb_id, media_type: s.media_type, title: s.title })),
      }),
    });

    if (state.editMode) {
      exitEditMode();
      toast("Preferences saved");
      showScreen("screen-lobby");
      return;
    }

    updateUserBadge();
    if (state.pendingCode) {
      $("join-code-input").value = state.pendingCode;
      state.pendingCode = null;
      handleJoinRoom();
    } else {
      showScreen("screen-lobby");
    }
  } catch (e) {
    err.textContent = "Error: " + e.message;
  }
}

// Open the quiz pre-filled with the current profile, to edit without a full reset.
async function openEditPrefs() {
  try {
    const p = await api(`/api/profile/${state.userId}`);
    state.genreLevels = {};
    for (const [id, score] of Object.entries(p.genre_scores || {})) {
      state.genreLevels[id] = Number(score) >= 0.9 ? 2 : 1;
    }
    state.avoidGenres = new Set((p.prefs?.avoid_genres || []).map(Number));
    state.seeds = (p.prefs?.seeds || []).map((s) => ({
      tmdb_id: s.tmdb_id,
      media_type: s.media_type,
      title: s.title || `#${s.tmdb_id}`,
    }));
  } catch {
    state.genreLevels = {};
    state.avoidGenres = new Set();
    state.seeds = [];
  }
  state.editMode = true;
  $("name-field").classList.add("hidden");
  $("onboarding-title").textContent = "Edit preferences";
  $("onboarding-continue").textContent = "Save";
  renderGenreChips();
  renderAvoidChips();
  renderSeedChips();
  hideSuggestions();
  $("onboarding-error").textContent = "";
  showScreen("screen-onboarding");
}

function exitEditMode() {
  state.editMode = false;
  $("name-field").classList.remove("hidden");
  $("onboarding-title").textContent = "Welcome 👋";
  $("onboarding-continue").textContent = "Continue";
}

// ── Lobby ────────────────────────────────────────────────────────────────────
function setupMediaToggle() {
  document.querySelectorAll("#media-toggle .toggle-opt").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#media-toggle .toggle-opt").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.mediaType = btn.dataset.media;
    };
  });
}

async function handleCreateRoom() {
  const err = $("lobby-error");
  err.textContent = "";
  try {
    const room = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        user_id: state.userId,
        media_type: state.mediaType,
        platform_filter: $("platform-select").value || null,
        solo: $("solo-check").checked,
      }),
    });
    state.room = room;
    state.soloMode = $("solo-check").checked;
    enterSwipe();
  } catch (e) {
    err.textContent = "Error: " + e.message;
  }
}

async function handleJoinRoom() {
  const err = $("lobby-error");
  err.textContent = "";
  const code = $("join-code-input").value.trim().toUpperCase();
  if (code.length !== 6) {
    err.textContent = "The code has 6 characters.";
    return;
  }
  try {
    const room = await api("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ user_id: state.userId, join_code: code }),
    });
    state.room = room;
    state.soloMode = false;
    state.mediaType = room.media_type;
    enterSwipe();
  } catch (e) {
    err.textContent = "Error: " + e.message;
  }
}

// ── Swipe ────────────────────────────────────────────────────────────────────
async function enterSwipe() {
  showScreen("screen-swipe");
  $("room-code-label").textContent = state.soloMode ? "SOLO" : state.room.join_code;
  $("invite-bar").classList.toggle("hidden", state.soloMode);
  state.lastSwiped = null;
  updateUndo();
  syncMediaToggle();
  saveRoom(); // persist so a refresh restores the session instead of kicking to the lobby
  connectWs();
  await loadDeck();
}

// Persist / restore the current room so a page refresh keeps you in the game.
function saveRoom() {
  if (state.room) {
    localStorage.setItem("cinemate_room", JSON.stringify({ ...state.room, soloMode: state.soloMode }));
  }
}
function clearRoom() {
  localStorage.removeItem("cinemate_room");
}
function restoreRoom() {
  const raw = localStorage.getItem("cinemate_room");
  if (!raw) return false;
  try {
    const r = JSON.parse(raw);
    if (!r || !r.id) return false;
    state.room = r;
    state.soloMode = !!r.soloMode;
    state.mediaType = r.media_type || "movie";
    return true;
  } catch {
    return false;
  }
}

async function loadDeck() {
  $("card").classList.add("hidden");
  $("deck-empty").classList.add("hidden");
  $("deck-loading").textContent = "Loading the deck…";
  $("deck-loading").classList.remove("hidden");
  try {
    const res = await api(`/api/rooms/${state.room.id}/deck?user_id=${encodeURIComponent(state.userId)}`);
    state.deck = res.cards || [];
    state.deckIndex = 0;
    state.lastSwiped = null;
    updateUndo();
    $("deck-loading").classList.add("hidden");
    renderCard();
  } catch (e) {
    $("deck-loading").textContent = "Deck error: " + e.message;
  }
}

function syncMediaToggle() {
  document.querySelectorAll("#swipe-media-toggle .toggle-opt").forEach((b) => {
    b.classList.toggle("active", b.dataset.media === state.mediaType);
  });
}

async function toggleMedia(media) {
  if (media === state.mediaType) return;
  try {
    const room = await api(`/api/rooms/${state.room.id}`, {
      method: "PATCH",
      body: JSON.stringify({ user_id: state.userId, media_type: media }),
    });
    state.room = room;
    state.mediaType = media;
    syncMediaToggle();
    await loadDeck();
  } catch (e) {
    console.error("toggle media error", e);
  }
}

// New session / fresh deck: reset the pool + clear the room's swipes (both users start fresh).
async function newSession() {
  try {
    await api(`/api/rooms/${state.room.id}/new-session`, {
      method: "POST",
      body: JSON.stringify({ user_id: state.userId }),
    });
    await loadDeck();
    toast("Fresh deck ready");
  } catch (e) {
    console.error("new session error", e);
  }
}

function resetCardTransform() {
  const el = $("card");
  el.style.transition = "none";
  el.style.transform = "";
  $("stamp-like").style.opacity = 0;
  $("stamp-nope").style.opacity = 0;
}

function renderCard() {
  const card = state.deck[state.deckIndex];
  const el = $("card");
  resetCardTransform();
  if (!card) {
    el.classList.add("hidden");
    $("deck-empty").classList.remove("hidden");
    return;
  }
  $("deck-empty").classList.add("hidden");
  el.classList.remove("hidden");
  $("card-poster").style.backgroundImage = card.poster_path ? `url(${TMDB_IMG}${card.poster_path})` : "none";
  $("card-title").textContent = card.title;
  const bits = [];
  if (card.release_year) bits.push(card.release_year);
  const gnames = (card.genres || []).map((g) => GENRE_NAMES[g]).filter(Boolean).slice(0, 2);
  if (gnames.length) bits.push(gnames.join(", "));
  $("card-meta").textContent = bits.join("  ·  ");
  $("card-overview").textContent = card.overview || "";
  $("trailer-btn").classList.remove("hidden");
  $("trailer-btn").onclick = () => openTrailer(card.tmdb_id);
  renderRatings(card.tmdb_id, "card-rating");
}

// Fling the card off-screen, then register the swipe.
function flingAndSwipe(direction) {
  const el = $("card");
  const off = direction === "like" ? window.innerWidth + 200 : -(window.innerWidth + 200);
  el.style.transition = "transform 0.35s ease-out";
  el.style.transform = `translate(${off}px, -40px) rotate(${direction === "like" ? 22 : -22}deg)`;
  setTimeout(() => swipe(direction), 300);
}

async function swipe(direction) {
  const card = state.deck[state.deckIndex];
  if (!card) return;
  state.lastSwiped = { card };
  state.deckIndex++;
  updateUndo();
  renderCard();
  try {
    const res = await api(`/api/rooms/${state.room.id}/swipe`, {
      method: "POST",
      body: JSON.stringify({ user_id: state.userId, tmdb_id: card.tmdb_id, direction }),
    });
    if (res.matched && res.is_new_match) {
      if (state.soloMode) toast("💾 Saved to watchlist");
      else showMatch(card, res.match_reason);
    }
  } catch (e) {
    console.error("swipe error", e);
  }
}

function updateUndo() {
  $("undo-btn").disabled = !state.lastSwiped;
}

async function undo() {
  if (!state.lastSwiped) return;
  const { card } = state.lastSwiped;
  state.lastSwiped = null;
  state.deckIndex = Math.max(0, state.deckIndex - 1);
  updateUndo();
  renderCard();
  try {
    await api(`/api/rooms/${state.room.id}/swipe`, {
      method: "DELETE",
      body: JSON.stringify({ user_id: state.userId, tmdb_id: card.tmdb_id }),
    });
  } catch (e) {
    console.error("undo error", e);
  }
}

// Pointer-drag gestures (bound once to the card element).
function setupGestures() {
  const el = $("card");
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    if (el.classList.contains("hidden") || e.target.closest("#trailer-btn")) return;
    drag = { x: e.clientX, y: e.clientY, dx: 0 };
    el.setPointerCapture(e.pointerId);
    el.style.transition = "none";
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const rot = Math.max(-15, Math.min(15, drag.dx / 12));
    el.style.transform = `translate(${drag.dx}px, ${dy}px) rotate(${rot}deg)`;
    const p = Math.min(1, Math.abs(drag.dx) / SWIPE_THRESHOLD);
    $("stamp-like").style.opacity = drag.dx > 0 ? p : 0;
    $("stamp-nope").style.opacity = drag.dx < 0 ? p : 0;
  });
  const end = () => {
    if (!drag) return;
    const dx = drag.dx;
    drag = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD) {
      flingAndSwipe(dx > 0 ? "like" : "dislike");
    } else {
      el.style.transition = "transform 0.25s ease";
      el.style.transform = "";
      $("stamp-like").style.opacity = 0;
      $("stamp-nope").style.opacity = 0;
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

// ── Trailer ───────────────────────────────────────────────────────────────────
async function openTrailer(tmdbId) {
  try {
    const res = await api(`/api/rooms/${state.room.id}/trailer/${tmdbId}`);
    if (!res.youtube_key) {
      toast("No trailer available");
      return;
    }
    $("trailer-frame").innerHTML =
      `<iframe src="https://www.youtube.com/embed/${res.youtube_key}?autoplay=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    $("trailer-overlay").classList.remove("hidden");
  } catch {
    toast("No trailer available");
  }
}
function closeTrailer() {
  $("trailer-frame").innerHTML = "";
  $("trailer-overlay").classList.add("hidden");
}

// ── WebSocket (live) ────────────────────────────────────────────────────────
function connectWs() {
  if (state.soloMode) return;
  closeWs();
  const ws = new WebSocket(wsUrl(`/api/rooms/${state.room.id}/ws`));
  state.ws = ws;
  ws.addEventListener("open", () => $("ws-status").classList.add("live"));
  ws.addEventListener("close", () => $("ws-status").classList.remove("live"));
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "match") {
      const card = msg.card || state.deck.find((c) => c.tmdb_id === msg.tmdb_id) ||
        { tmdb_id: msg.tmdb_id, title: "Match!", poster_path: null };
      showMatch(card, msg.reason);
    } else if (msg.type === "deck_reset") {
      if (msg.media_type) {
        state.mediaType = msg.media_type;
        if (state.room) state.room.media_type = msg.media_type;
        syncMediaToggle();
      }
      loadDeck();
    }
  });
}
function closeWs() {
  if (state.ws) {
    try {
      state.ws.close();
    } catch {
      /* already closed */
    }
    state.ws = null;
  }
}

// ── Match screen ────────────────────────────────────────────────────────────
let currentMatchCard = null;
function showMatch(card, reason) {
  currentMatchCard = card;
  $("match-poster").style.backgroundImage = card.poster_path ? `url(${TMDB_IMG}${card.poster_path})` : "none";
  $("match-name").textContent = card.title || "Match!";
  const bits = [];
  if (card.release_year) bits.push(card.release_year);
  if (card.vote_average) bits.push("⭐ " + card.vote_average.toFixed(1));
  $("match-meta").textContent = bits.join("  ·  ");
  $("match-reason").textContent = reason || "";
  const media = card.media_type || state.mediaType;
  $("match-tmdb-link").href = `https://www.themoviedb.org/${media}/${card.tmdb_id}`;
  renderRatings(card.tmdb_id, "match-rating");
  renderProviders(card.tmdb_id);
  showScreen("screen-match");
}

// Masked PIN modal. Resolves with the entered PIN, or null if cancelled.
function askPin(errorMsg) {
  return new Promise((resolve) => {
    const overlay = $("pin-overlay");
    const input = $("pin-input");
    input.value = "";
    $("pin-error").textContent = errorMsg || "";
    overlay.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);
    const done = (val) => {
      overlay.classList.add("hidden");
      $("pin-ok").onclick = null;
      $("pin-cancel").onclick = null;
      input.onkeydown = null;
      resolve(val);
    };
    $("pin-ok").onclick = () => done(input.value.trim() || null);
    $("pin-cancel").onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter") done(input.value.trim() || null);
      else if (e.key === "Escape") done(null);
    };
  });
}

// Shared Overseerr request flow: masked PIN (re-asks on a wrong PIN), success alert with title.
async function overseerrRequest(path, extraBody, label) {
  let pin = localStorage.getItem("cinemate_request_pin");
  let errorMsg = "";
  for (;;) {
    if (!pin) {
      pin = await askPin(errorMsg);
      if (!pin) return; // cancelled
      localStorage.setItem("cinemate_request_pin", pin);
    }
    try {
      await api(path, { method: "POST", body: JSON.stringify({ user_id: state.userId, pin, ...extraBody }) });
      toast(`✅ ${label ? `"${label}" ` : ""}added to Overseerr`);
      return;
    } catch (e) {
      if (e.message === "invalid_pin") {
        localStorage.removeItem("cinemate_request_pin");
        pin = null;
        errorMsg = "Wrong PIN — try again";
        continue; // re-open the modal with the error
      }
      toast(
        e.message === "requests_disabled"
          ? "Requests are disabled"
          : e.message === "not_configured"
            ? "Overseerr not set up"
            : "Overseerr request failed",
      );
      return;
    }
  }
}

async function addToOverseerr() {
  if (!currentMatchCard) return;
  const btn = $("add-overseerr-btn");
  btn.disabled = true;
  await overseerrRequest(
    `/api/rooms/${state.room.id}/request`,
    { tmdb_id: currentMatchCard.tmdb_id },
    currentMatchCard.title,
  );
  btn.disabled = false;
}

async function renderRatings(tmdbId, elId) {
  const el = $(elId);
  el.textContent = "";
  try {
    const res = await api(`/api/rooms/${state.room.id}/rating/${tmdbId}`);
    const r = res.ratings || {};
    const parts = [];
    if (r.imdb_rating) parts.push(`IMDb ${r.imdb_rating}`);
    if (r.rotten_tomatoes) parts.push(`🍅 ${r.rotten_tomatoes}`);
    if (r.metacritic) parts.push(`MC ${r.metacritic}`);
    el.textContent = parts.join("   ");
  } catch {
    // best-effort
  }
}

async function renderProviders(tmdbId) {
  const box = $("match-providers");
  box.innerHTML = "";
  try {
    const res = await api(`/api/rooms/${state.room.id}/providers/${tmdbId}`);
    const p = res.providers || {};
    const list = (p.flatrate && p.flatrate.length ? p.flatrate : p.rent || []).slice(0, 5);
    if (!list.length) {
      box.innerHTML = "<span class='muted'>No RO streaming data</span>";
      return;
    }
    const label = document.createElement("span");
    label.className = "muted providers-label";
    label.textContent = p.flatrate && p.flatrate.length ? "Streaming:" : "Rent:";
    box.appendChild(label);
    list.forEach((prov) => {
      const el = document.createElement("span");
      el.className = "provider";
      el.title = prov.name;
      if (prov.logo_path) {
        const img = document.createElement("img");
        img.src = `${TMDB_LOGO}${prov.logo_path}`;
        img.alt = prov.name;
        el.appendChild(img);
      } else {
        el.textContent = prov.name;
      }
      box.appendChild(el);
    });
  } catch {
    box.innerHTML = "";
  }
}

// ── Card lists ──────────────────────────────────────────────────────────────
function renderCardList(container, items, emptyText, onRequest) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = `<p class='muted'>${emptyText}</p>`;
    return;
  }
  items.forEach((m) => {
    const c = m.card || {};
    const item = document.createElement("div");
    item.className = "match-item";
    const poster = document.createElement("div");
    poster.className = "poster";
    if (c.poster_path) poster.style.backgroundImage = `url(${TMDB_IMG}${c.poster_path})`;
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = c.title || `#${m.tmdb_id}`;
    const link = document.createElement("a");
    link.className = "btn-link";
    link.textContent = "View on TMDb ↗";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.href = `https://www.themoviedb.org/${m.media_type}/${m.tmdb_id}`;
    info.appendChild(title);
    info.appendChild(document.createElement("br"));
    info.appendChild(link);
    if (onRequest) {
      const reqBtn = document.createElement("button");
      reqBtn.className = "chip-btn";
      reqBtn.textContent = "➕ Overseerr";
      reqBtn.onclick = () => onRequest(m);
      info.appendChild(document.createElement("br"));
      info.appendChild(reqBtn);
    }
    item.appendChild(poster);
    item.appendChild(info);
    container.appendChild(item);
  });
}

async function showMatchesList() {
  showScreen("screen-matches");
  const list = $("matches-list");
  list.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const res = await api(`/api/rooms/${state.room.id}/matches`);
    renderCardList(list, res.matches || [], "No matches yet.", (m) =>
      overseerrRequest(`/api/rooms/${state.room.id}/request`, { tmdb_id: m.tmdb_id }, (m.card || {}).title),
    );
  } catch (e) {
    list.innerHTML = "<p class='error'>Error: " + e.message + "</p>";
  }
}

async function showWatchlist() {
  showScreen("screen-watchlist");
  const list = $("watchlist-list");
  list.innerHTML = "<p class='muted'>Loading…</p>";
  try {
    const res = await api(`/api/users/${state.userId}/watchlist`);
    renderCardList(list, res.watchlist || [], "Your watchlist is empty. Like titles in solo mode.", (m) =>
      overseerrRequest(
        `/api/users/${state.userId}/request`,
        { tmdb_id: m.tmdb_id, media_type: m.media_type },
        (m.card || {}).title,
      ),
    );
  } catch (e) {
    list.innerHTML = "<p class='error'>Error: " + e.message + "</p>";
  }
}

// Logo → home: leave any room and go to the lobby (or onboarding if not set up yet).
function goHome() {
  if (state.userId && state.username) {
    closeWs();
    clearRoom();
    state.room = null;
    showScreen("screen-lobby");
  } else {
    showScreen("screen-onboarding");
  }
}

// ── Profile / reset ────────────────────────────────────────────────────────
function showProfile() {
  $("profile-name").textContent = state.username ? `Signed in as ${state.username}` : "";
  showScreen("screen-profile");
}

function resetData() {
  localStorage.removeItem("cinemate_user_id");
  localStorage.removeItem("cinemate_username");
  closeWs();
  state.userId = null;
  state.username = null;
  exitEditMode();
  clearRoom();
  state.genreLevels = {};
  state.avoidGenres = new Set();
  state.seeds = [];
  $("seed-input").value = "";
  renderSeedChips();
  hideSuggestions();
  state.room = null;
  state.soloMode = false;
  state.deck = [];
  state.deckIndex = 0;
  state.pendingCode = null;
  state.lastSwiped = null;
  $("user-badge").classList.add("hidden");
  $("username-input").value = "";
  renderGenreChips();
  renderAvoidChips();
  showScreen("screen-onboarding");
}

// ── Invite ────────────────────────────────────────────────────────────────────
function inviteLink() {
  return `${location.origin}/join?code=${state.room.join_code}`;
}
async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label + " copied");
  } catch {
    toast("Copy failed");
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  renderGenreChips();
  renderAvoidChips();
  setupSeedSearch();
  setupMediaToggle();
  setupGestures();

  $("onboarding-continue").onclick = handleOnboarding;
  $("create-room-btn").onclick = handleCreateRoom;
  $("join-room-btn").onclick = handleJoinRoom;
  $("watchlist-btn").onclick = showWatchlist;
  $("watchlist-back-btn").onclick = () => showScreen("screen-lobby");
  $("like-btn").onclick = () => flingAndSwipe("like");
  $("dislike-btn").onclick = () => flingAndSwipe("dislike");
  $("undo-btn").onclick = undo;
  document.querySelectorAll("#swipe-media-toggle .toggle-opt").forEach((b) => {
    b.onclick = () => toggleMedia(b.dataset.media);
  });
  $("view-matches-btn").onclick = showMatchesList;
  $("new-session-btn").onclick = newSession;
  $("matches-back-btn").onclick = () => showScreen("screen-swipe");
  $("match-continue-btn").onclick = () => showScreen("screen-swipe");
  $("add-overseerr-btn").onclick = addToOverseerr;
  $("copy-link-btn").onclick = () => copyText(inviteLink(), "Invite link");
  $("app-logo").onclick = goHome;
  $("user-badge").onclick = showProfile;
  $("edit-prefs-btn").onclick = openEditPrefs;
  $("reset-btn").onclick = resetData;
  $("profile-back-btn").onclick = () => showScreen("screen-lobby");
  $("trailer-close").onclick = closeTrailer;
  $("trailer-overlay").onclick = (e) => {
    if (e.target === $("trailer-overlay")) closeTrailer();
  };

  const pendingCode = (new URLSearchParams(location.search).get("code") || "").trim().toUpperCase();
  if (state.userId && state.username) {
    updateUserBadge();
    if (pendingCode) {
      // An invite link wins over any saved room.
      $("join-code-input").value = pendingCode;
      handleJoinRoom();
    } else if (restoreRoom()) {
      // Refreshed mid-game → resume the room instead of dropping to the lobby.
      enterSwipe();
    } else {
      showScreen("screen-lobby");
    }
  } else {
    state.pendingCode = pendingCode || null;
    showScreen("screen-onboarding");
  }
}

init();
