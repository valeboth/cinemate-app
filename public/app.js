// Cinemate frontend — vanilla JS (no framework in V1).

// ── API config ─────────────────────────────────────────────────────────────
// Same-origin: the Worker serves both the static assets (Workers Static Assets) and /api.
const API_BASE = "";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_LOGO = "https://image.tmdb.org/t/p/w92";

function wsUrl(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

// ── TMDb genres (quiz subset) ───────────────────────────────────────────────
const GENRES = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 35, name: "Comedy" },
  { id: 18, name: "Drama" },
  { id: 27, name: "Horror" },
  { id: 878, name: "Sci-Fi" },
  { id: 53, name: "Thriller" },
  { id: 10749, name: "Romance" },
  { id: 16, name: "Animation" },
  { id: 9648, name: "Mystery" },
  { id: 14, name: "Fantasy" },
  { id: 80, name: "Crime" },
];

// Genre score by level: 1 = like, 2 = love.
const LEVEL_SCORE = { 1: 0.6, 2: 1.0 };

// ── App state ───────────────────────────────────────────────────────────────
const state = {
  userId: localStorage.getItem("cinemate_user_id") || null,
  username: localStorage.getItem("cinemate_username") || null,
  genreLevels: {}, // genreId -> 1 (like) | 2 (love)
  era: "", // "" | "recent" | "classic"
  mediaType: "movie",
  room: null,
  soloMode: false,
  deck: [],
  deckIndex: 0,
  ws: null,
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

// ── Screen navigation ─────────────────────────────────────────────────────────
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
  const badge = $("user-badge");
  if (state.username) {
    badge.textContent = "👤 " + state.username;
    badge.classList.remove("hidden");
  }
}

// ── Onboarding ──────────────────────────────────────────────────────────────
function renderGenreChips() {
  const box = $("genre-chips");
  box.innerHTML = "";
  GENRES.forEach((g) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset.id = g.id;
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
    const user = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
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
      body: JSON.stringify({
        user_id: user.id,
        genre_scores: genreScores,
        era_pref: state.era || null,
      }),
    });

    updateUserBadge();
    showScreen("screen-lobby");
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
  const solo = $("solo-check").checked;
  const platform = $("platform-select").value || null;
  try {
    const room = await api("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        user_id: state.userId,
        media_type: state.mediaType,
        platform_filter: platform,
        solo,
      }),
    });
    state.room = room;
    state.soloMode = solo;
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
    const res = await api(`/api/rooms/${state.room.id}/deck`);
    state.deck = res.cards || [];
    state.deckIndex = 0;
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

// Live movie/TV toggle: change media_type on the room → the pool regenerates.
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

function renderCard() {
  const card = state.deck[state.deckIndex];
  if (!card) {
    $("card").classList.add("hidden");
    $("deck-empty").classList.remove("hidden");
    return;
  }
  $("deck-empty").classList.add("hidden");
  $("card").classList.remove("hidden");
  $("card-poster").style.backgroundImage = card.poster_path
    ? `url(${TMDB_IMG}${card.poster_path})`
    : "none";
  $("card-title").textContent = card.title;
  const bits = [];
  if (card.release_year) bits.push(card.release_year);
  if (card.vote_average) bits.push("⭐ " + card.vote_average.toFixed(1));
  $("card-meta").textContent = bits.join("  ·  ");
  $("card-overview").textContent = card.overview || "(no description)";
}

async function swipe(direction) {
  const card = state.deck[state.deckIndex];
  if (!card) return;
  state.deckIndex++;
  renderCard();
  try {
    const res = await api(`/api/rooms/${state.room.id}/swipe`, {
      method: "POST",
      body: JSON.stringify({ user_id: state.userId, tmdb_id: card.tmdb_id, direction }),
    });
    if (res.matched && res.is_new_match) {
      if (state.soloMode) {
        toast("💾 Saved to watchlist");
      } else {
        showMatch(card, res.match_reason);
      }
    }
  } catch (e) {
    console.error("swipe error", e);
  }
}

// ── WebSocket (live) ────────────────────────────────────────────────────────
function connectWs() {
  if (state.soloMode) return; // no live in solo
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
      const card =
        msg.card || state.deck.find((c) => c.tmdb_id === msg.tmdb_id) || {
          tmdb_id: msg.tmdb_id,
          title: "Match!",
          poster_path: null,
        };
      showMatch(card, msg.reason);
    } else if (msg.type === "deck_reset") {
      // the other user switched movie/TV → sync and reload the deck
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
  $("match-poster").style.backgroundImage = card.poster_path
    ? `url(${TMDB_IMG}${card.poster_path})`
    : "none";
  $("match-name").textContent = card.title || "Match!";
  const bits = [];
  if (card.release_year) bits.push(card.release_year);
  if (card.vote_average) bits.push("⭐ " + card.vote_average.toFixed(1));
  $("match-meta").textContent = bits.join("  ·  ");
  $("match-reason").textContent = reason || "";
  const media = card.media_type || state.mediaType;
  $("match-tmdb-link").href = `https://www.themoviedb.org/${media}/${card.tmdb_id}`;
  renderProviders(card.tmdb_id);
  showScreen("screen-match");
}

// "Where to watch" — RO watch providers (streaming first).
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

// ── Card lists (matches + watchlist) ──────────────────────────────────────────
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

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  renderGenreChips();
  setupEraToggle();
  setupMediaToggle();

  $("onboarding-continue").onclick = handleOnboarding;
  $("create-room-btn").onclick = handleCreateRoom;
  $("join-room-btn").onclick = handleJoinRoom;
  $("watchlist-btn").onclick = showWatchlist;
  $("watchlist-back-btn").onclick = () => showScreen("screen-lobby");
  $("like-btn").onclick = () => swipe("like");
  $("dislike-btn").onclick = () => swipe("dislike");
  document.querySelectorAll("#swipe-media-toggle .toggle-opt").forEach((b) => {
    b.onclick = () => toggleMedia(b.dataset.media);
  });
  $("view-matches-btn").onclick = showMatchesList;
  $("matches-back-btn").onclick = () => showScreen("screen-swipe");
  $("match-continue-btn").onclick = () => showScreen("screen-swipe");

  // Known user → skip onboarding.
  if (state.userId && state.username) {
    updateUserBadge();
    showScreen("screen-lobby");
  } else {
    showScreen("screen-onboarding");
  }
}

init();
