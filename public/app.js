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
// Quiz subset (with ids).
const GENRES = [
  { id: 28, name: "Action" }, { id: 12, name: "Adventure" }, { id: 35, name: "Comedy" },
  { id: 18, name: "Drama" }, { id: 27, name: "Horror" }, { id: 878, name: "Sci-Fi" },
  { id: 53, name: "Thriller" }, { id: 10749, name: "Romance" }, { id: 16, name: "Animation" },
  { id: 9648, name: "Mystery" }, { id: 14, name: "Fantasy" }, { id: 80, name: "Crime" },
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
  era: "",
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
    chip.textContent = g.name;
    chip.onclick = () => {
      const level = (state.genreLevels[g.id] || 0) + 1;
      if (level > 2) {
        delete state.genreLevels[g.id];
        chip.classList.remove("like", "love");
        chip.textContent = g.name;
      } else {
        state.genreLevels[g.id] = level;
        chip.classList.toggle("like", level === 1);
        chip.classList.toggle("love", level === 2);
        chip.textContent = g.name + (level === 2 ? " ♥♥" : " ♥");
      }
    };
    box.appendChild(chip);
  });
}

function setupEraToggle() {
  document.querySelectorAll("#era-toggle .toggle-opt").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll("#era-toggle .toggle-opt").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.era = btn.dataset.era;
    };
  });
}

async function handleOnboarding() {
  const err = $("onboarding-error");
  err.textContent = "";
  const username = $("username-input").value.trim();
  if (!username) {
    err.textContent = "Please enter a name.";
    return;
  }
  try {
    const user = await api("/api/users", { method: "POST", body: JSON.stringify({ username }) });
    state.userId = user.id;
    state.username = user.username;
    localStorage.setItem("cinemate_user_id", user.id);
    localStorage.setItem("cinemate_username", user.username);

    const genreScores = {};
    for (const [id, level] of Object.entries(state.genreLevels)) {
      genreScores[id] = LEVEL_SCORE[level] || 0.6;
    }
    await api("/api/profile/quiz", {
      method: "POST",
      body: JSON.stringify({ user_id: user.id, genre_scores: genreScores, era_pref: state.era || null }),
    });

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
  connectWs();
  await loadDeck();
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
function showMatch(card, reason) {
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
function renderCardList(container, items, emptyText) {
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
    renderCardList(list, res.matches || [], "No matches yet.");
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
    renderCardList(list, res.watchlist || [], "Your watchlist is empty. Like titles in solo mode.");
  } catch (e) {
    list.innerHTML = "<p class='error'>Error: " + e.message + "</p>";
  }
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
  setupEraToggle();
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
  $("matches-back-btn").onclick = () => showScreen("screen-swipe");
  $("match-continue-btn").onclick = () => showScreen("screen-swipe");
  $("copy-code-btn").onclick = () => copyText(state.room.join_code, "Code");
  $("copy-link-btn").onclick = () => copyText(inviteLink(), "Link");
  $("trailer-close").onclick = closeTrailer;
  $("trailer-overlay").onclick = (e) => {
    if (e.target === $("trailer-overlay")) closeTrailer();
  };

  const pendingCode = (new URLSearchParams(location.search).get("code") || "").trim().toUpperCase();
  if (state.userId && state.username) {
    updateUserBadge();
    if (pendingCode) {
      $("join-code-input").value = pendingCode;
      handleJoinRoom();
    } else {
      showScreen("screen-lobby");
    }
  } else {
    state.pendingCode = pendingCode || null;
    showScreen("screen-onboarding");
  }
}

init();
