// Cinemate frontend — vanilla JS (fără framework în V1).

// ── Config API ────────────────────────────────────────────────────────────
// Same-origin: Worker-ul servește și static-ul (Workers Static Assets) și /api.
const API_BASE = "";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

function wsUrl(path) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

// ── Genuri TMDb (subset pentru quiz) ──────────────────────────────────────
const GENRES = [
  { id: 28, name: "Acțiune" },
  { id: 12, name: "Aventură" },
  { id: 35, name: "Comedie" },
  { id: 18, name: "Dramă" },
  { id: 27, name: "Horror" },
  { id: 878, name: "SF" },
  { id: 53, name: "Thriller" },
  { id: 10749, name: "Romantic" },
  { id: 16, name: "Animație" },
  { id: 9648, name: "Mister" },
  { id: 14, name: "Fantezie" },
  { id: 80, name: "Crimă" },
];

// ── Stare aplicație ────────────────────────────────────────────────────────
const state = {
  userId: localStorage.getItem("cinemate_user_id") || null,
  username: localStorage.getItem("cinemate_username") || null,
  selectedGenres: new Set(),
  mediaType: "movie",
  room: null,
  soloMode: false,
  deck: [],
  deckIndex: 0,
  ws: null,
};

// ── Helperi API ──────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Navigare ecrane ────────────────────────────────────────────────────────
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
    chip.textContent = g.name;
    chip.onclick = () => {
      if (state.selectedGenres.has(g.id)) {
        state.selectedGenres.delete(g.id);
        chip.classList.remove("active");
      } else {
        state.selectedGenres.add(g.id);
        chip.classList.add("active");
      }
    };
    box.appendChild(chip);
  });
}

async function handleOnboarding() {
  const err = $("onboarding-error");
  err.textContent = "";
  const username = $("username-input").value.trim();
  if (!username) {
    err.textContent = "Scrie un nume.";
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

    // genre_scores: 1.0 pentru genurile alese
    const genreScores = {};
    state.selectedGenres.forEach((id) => {
      genreScores[id] = 1.0;
    });
    await api("/api/profile/quiz", {
      method: "POST",
      body: JSON.stringify({ user_id: user.id, genre_scores: genreScores }),
    });

    updateUserBadge();
    showScreen("screen-lobby");
  } catch (e) {
    err.textContent = "Eroare: " + e.message;
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
    err.textContent = "Eroare: " + e.message;
  }
}

async function handleJoinRoom() {
  const err = $("lobby-error");
  err.textContent = "";
  const code = $("join-code-input").value.trim().toUpperCase();
  if (code.length !== 6) {
    err.textContent = "Codul are 6 caractere.";
    return;
  }
  try {
    const room = await api("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ user_id: state.userId, join_code: code }),
    });
    state.room = room;
    state.soloMode = false;
    enterSwipe();
  } catch (e) {
    err.textContent = "Eroare: " + e.message;
  }
}

// ── Swipe ────────────────────────────────────────────────────────────────────
async function enterSwipe() {
  showScreen("screen-swipe");
  $("room-code-label").textContent = state.soloMode ? "SOLO" : state.room.join_code;
  $("card").classList.add("hidden");
  $("deck-empty").classList.add("hidden");
  $("deck-loading").classList.remove("hidden");

  connectWs();

  try {
    const res = await api(`/api/rooms/${state.room.id}/deck`);
    state.deck = res.cards || [];
    state.deckIndex = 0;
    $("deck-loading").classList.add("hidden");
    renderCard();
  } catch (e) {
    $("deck-loading").textContent = "Eroare la deck: " + e.message;
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
  $("card-overview").textContent = card.overview || "(fără descriere)";
}

async function swipe(direction) {
  const card = state.deck[state.deckIndex];
  if (!card) return;
  state.deckIndex++;
  renderCard();
  try {
    const res = await api(`/api/rooms/${state.room.id}/swipe`, {
      method: "POST",
      body: JSON.stringify({
        user_id: state.userId,
        tmdb_id: card.tmdb_id,
        direction,
      }),
    });
    if (res.matched && res.is_new_match) {
      if (state.soloMode) {
        toast("💾 Salvat în watchlist");
      } else {
        showMatch(card);
      }
    }
  } catch (e) {
    console.error("swipe error", e);
  }
}

// ── WebSocket live ────────────────────────────────────────────────────────────
function connectWs() {
  if (state.soloMode) return; // fără live în solo
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
      showMatch(card);
    }
  });
}

function closeWs() {
  if (state.ws) {
    try {
      state.ws.close();
    } catch {
      /* deja închis */
    }
    state.ws = null;
  }
}

// ── Match screen ────────────────────────────────────────────────────────────
function showMatch(card) {
  $("match-poster").style.backgroundImage = card.poster_path
    ? `url(${TMDB_IMG}${card.poster_path})`
    : "none";
  $("match-name").textContent = card.title || "Match!";
  const bits = [];
  if (card.release_year) bits.push(card.release_year);
  if (card.vote_average) bits.push("⭐ " + card.vote_average.toFixed(1));
  $("match-meta").textContent = bits.join("  ·  ");
  const media = card.media_type || state.mediaType;
  $("match-tmdb-link").href = `https://www.themoviedb.org/${media}/${card.tmdb_id}`;
  showScreen("screen-match");
}

// ── Matches list ────────────────────────────────────────────────────────────
async function showMatchesList() {
  showScreen("screen-matches");
  const list = $("matches-list");
  list.innerHTML = "<p class='muted'>Se încarcă…</p>";
  try {
    const res = await api(`/api/rooms/${state.room.id}/matches`);
    if (!res.matches.length) {
      list.innerHTML = "<p class='muted'>Încă niciun match.</p>";
      return;
    }
    list.innerHTML = "";
    res.matches.forEach((m) => {
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
      link.textContent = "Vezi pe TMDb ↗";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.href = `https://www.themoviedb.org/${m.media_type}/${m.tmdb_id}`;
      info.appendChild(title);
      info.appendChild(document.createElement("br"));
      info.appendChild(link);
      item.appendChild(poster);
      item.appendChild(info);
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = "<p class='error'>Eroare: " + e.message + "</p>";
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
  renderGenreChips();
  setupMediaToggle();

  $("onboarding-continue").onclick = handleOnboarding;
  $("create-room-btn").onclick = handleCreateRoom;
  $("join-room-btn").onclick = handleJoinRoom;
  $("like-btn").onclick = () => swipe("like");
  $("dislike-btn").onclick = () => swipe("dislike");
  $("view-matches-btn").onclick = showMatchesList;
  $("matches-back-btn").onclick = () => showScreen("screen-swipe");
  $("match-continue-btn").onclick = () => showScreen("screen-swipe");

  // Utilizator deja cunoscut → sari peste onboarding.
  if (state.userId && state.username) {
    updateUserBadge();
    showScreen("screen-lobby");
  } else {
    showScreen("screen-onboarding");
  }
}

init();
