import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDWZULdUu_7x6PG8ggSWiODMKeHK0ddj8",
  authDomain: "sos-game-78831.firebaseapp.com",
  projectId: "sos-game-78831",
  storageBucket: "sos-game-78831.firebasestorage.app",
  messagingSenderId: "131969888495",
  appId: "1:131969888495:web:114dfb000736969e71eb1a",
  measurementId: "G-KKS99RC8BL"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const setupScreen = $("setupScreen");
const gameScreen = $("gameScreen");
const boardEl = $("board");
const modeSelect = $("modeSelect");
const playerCountInput = $("playerCountInput");
const boardSizeInput = $("boardSizeInput");
const messageEl = $("message");
const setupMessage = $("setupMessage");
const firebaseStatus = $("firebaseStatus");
const debugBox = $("debugBox");

const DIRECTIONS = [[0,1], [1,0], [1,1], [1,-1]];
let state = freshState(10, "ai", 2);
let selectedLetter = "S";
let unsubscribeRoom = null;
let currentRoomId = new URLSearchParams(location.search).get("room") || "";
let myOnlinePlayer = currentRoomId ? localStorage.getItem(`sos-player-${currentRoomId}`) || "" : "";
let createdThisSession = false;

function clampSize(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 3), 40);
}
function clampPlayers(value, mode) {
  if (mode === "ai") return 2;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 2;
  return Math.min(Math.max(n, 2), 4);
}
function playerKeys(count) { return Array.from({ length: count }, (_, i) => `P${i + 1}`); }
function playerLabel(player, mode = state.mode) {
  if (mode === "ai" && player === "P2") return "AI";
  return `Player ${String(player).replace("P", "")}`;
}
function indexOf(row, col, size) { return row * size + col; }
function getCell(board, size, row, col) { return board[indexOf(row, col, size)] || ""; }
function setCell(board, size, row, col, value) { board[indexOf(row, col, size)] = value; }
function inBounds(row, col, size) { return row >= 0 && row < size && col >= 0 && col < size; }
function boardFull(board) { return board.every(Boolean); }
function makeFlatBoard(size) { return Array(size * size).fill(""); }

function freshState(size, mode, requestedPlayers) {
  const playerCount = clampPlayers(requestedPlayers, mode);
  const players = playerKeys(playerCount);
  const scores = {};
  const joined = {};
  players.forEach(p => { scores[p] = 0; joined[p] = p === "P1" || mode !== "online"; });
  return {
    version: 8,
    size,
    mode,
    playerCount,
    players,
    joined,
    board: makeFlatBoard(size),
    currentPlayer: "P1",
    scores,
    winningLines: [],
    lastMessage: "Choose S or O, then click a square.",
    updatedAt: null
  };
}

function normalizeRemote(data) {
  const size = clampSize(data?.size || 10);
  const mode = data?.mode || "online";
  const playerCount = clampPlayers(data?.playerCount || 2, mode);
  const players = playerKeys(playerCount);
  let board = data?.board;
  if (Array.isArray(board) && Array.isArray(board[0])) board = board.flat();
  if (!Array.isArray(board)) board = makeFlatBoard(size);
  if (board.length !== size * size) {
    const fixed = makeFlatBoard(size);
    for (let i = 0; i < Math.min(fixed.length, board.length); i++) fixed[i] = board[i] || "";
    board = fixed;
  }
  const scores = {};
  const joined = {};
  players.forEach(p => {
    scores[p] = Number(data?.scores?.[p] || 0);
    joined[p] = Boolean(data?.joined?.[p]) || (mode !== "online");
  });
  if (mode === "online") joined.P1 = true;
  const currentPlayer = players.includes(data?.currentPlayer) ? data.currentPlayer : "P1";
  return {
    version: 8,
    size,
    mode,
    playerCount,
    players,
    joined,
    board,
    currentPlayer,
    scores,
    winningLines: Array.isArray(data?.winningLines) ? data.winningLines : [],
    lastMessage: data?.lastMessage || "Choose S or O, then click a square.",
    updatedAt: data?.updatedAt || null
  };
}

function nextPlayerAfter(player, s) {
  const players = s.players || playerKeys(s.playerCount);
  const idx = players.indexOf(player);
  return players[(idx + 1) % players.length] || "P1";
}
function showSetup() { setupScreen.classList.remove("hidden"); gameScreen.classList.add("hidden"); }
function showGame() { setupScreen.classList.add("hidden"); gameScreen.classList.remove("hidden"); }
function showSetupMessage(text, isError = false) {
  setupMessage.textContent = text;
  setupMessage.classList.remove("hidden");
  setupMessage.classList.toggle("error", isError);
}
function showDebug(err, prefix = "Firebase error") {
  const text = `${prefix}\n${err?.code || "no-code"}: ${err?.message || String(err)}`;
  debugBox.textContent = text;
  debugBox.classList.remove("hidden");
  console.error(err);
}
function clearDebug() { debugBox.textContent = ""; debugBox.classList.add("hidden"); }

function countSOSFromMove(board, size, row, col) {
  let count = 0;
  const lines = [];
  for (const [dr, dc] of DIRECTIONS) {
    for (let offset = -2; offset <= 0; offset++) {
      let word = "";
      const cells = [];
      for (let i = 0; i < 3; i++) {
        const r = row + (offset + i) * dr;
        const c = col + (offset + i) * dc;
        if (!inBounds(r, c, size)) { word = ""; break; }
        word += getCell(board, size, r, c);
        cells.push(`${r},${c}`);
      }
      if (word === "SOS") { count++; lines.push(cells); }
    }
  }
  return { count, lines };
}

function applyMoveToState(baseState, row, col, letter, player) {
  const base = normalizeRemote(baseState);
  if (!inBounds(row, col, base.size)) return null;
  if (getCell(base.board, base.size, row, col)) return null;
  const next = JSON.parse(JSON.stringify(base));
  setCell(next.board, next.size, row, col, letter);
  const result = countSOSFromMove(next.board, next.size, row, col);
  if (result.count > 0) {
    next.scores[player] = Number(next.scores[player] || 0) + result.count;
    next.winningLines = [...next.winningLines, ...result.lines];
    next.currentPlayer = player;
    next.lastMessage = `${playerLabel(player, next.mode)} made ${result.count} SOS and gets another turn.`;
  } else {
    next.currentPlayer = nextPlayerAfter(player, next);
    next.lastMessage = `${playerLabel(next.currentPlayer, next.mode)}'s turn.`;
  }
  if (boardFull(next.board)) next.lastMessage = "Game over. The board is full.";
  return next;
}

function renderScores() {
  const scoreBar = $("scoreBar");
  scoreBar.innerHTML = "";
  const turnTile = document.createElement("div");
  turnTile.className = "score-tile active";
  turnTile.innerHTML = `<span>Turn</span><strong>${playerLabel(state.currentPlayer, state.mode)}</strong>`;
  scoreBar.appendChild(turnTile);
  state.players.forEach(p => {
    const tile = document.createElement("div");
    tile.className = "score-tile" + (p === state.currentPlayer ? " active" : "");
    tile.innerHTML = `<span>${playerLabel(p, state.mode)}</span><strong>${state.scores[p] || 0}</strong>`;
    scoreBar.appendChild(tile);
  });
}

function render() {
  state = normalizeRemote(state);
  clearDebug();
  $("boardTitle").textContent = `Board: ${state.size} × ${state.size}`;
  messageEl.textContent = state.lastMessage;
  renderScores();

  if (state.mode === "online") {
    $("roomStatus").textContent = myOnlinePlayer ? `You are ${playerLabel(myOnlinePlayer, state.mode)}.` : `Room full. This game already has ${state.playerCount} players.`;
    $("playerLabel").textContent = myOnlinePlayer ? `This device: ${playerLabel(myOnlinePlayer, state.mode)}` : "No spectator access";
  } else {
    $("roomStatus").textContent = "Choose S or O, then play.";
    $("playerLabel").textContent = "";
  }

  const showOwnerActions = state.mode !== "online" || myOnlinePlayer === "P1" || createdThisSession;
  $("ownerActions").classList.toggle("hidden", !showOwnerActions);
  if (currentRoomId && showOwnerActions) {
    $("roomBox").classList.remove("hidden");
    $("roomLink").textContent = `${location.origin}${location.pathname}?room=${currentRoomId}`;
  } else {
    $("roomBox").classList.add("hidden");
  }

  const winCells = new Set();
  state.winningLines.forEach(line => line.forEach(cell => winCells.add(cell)));
  boardEl.innerHTML = "";
  const cellSize = window.innerWidth <= 820 ? 44 : 38;
  boardEl.style.gridTemplateColumns = `repeat(${state.size}, ${cellSize}px)`;

  for (let row = 0; row < state.size; row++) {
    for (let col = 0; col < state.size; col++) {
      const value = getCell(state.board, state.size, row, col);
      const btn = document.createElement("button");
      btn.className = "cell" + (winCells.has(`${row},${col}`) ? " win" : "");
      btn.textContent = value;
      const notMyOnlineTurn = state.mode === "online" && (!myOnlinePlayer || state.currentPlayer !== myOnlinePlayer);
      btn.disabled = Boolean(value) || boardFull(state.board) || notMyOnlineTurn || (state.mode === "ai" && state.currentPlayer === "P2");
      btn.addEventListener("click", () => handleCellClick(row, col));
      boardEl.appendChild(btn);
    }
  }
}

async function handleCellClick(row, col) {
  clearDebug();
  if (state.mode === "online" && currentRoomId) {
    if (!myOnlinePlayer) { messageEl.textContent = `This room already has ${state.playerCount} players.`; return; }
    if (state.currentPlayer !== myOnlinePlayer) { messageEl.textContent = `It is ${playerLabel(state.currentPlayer, state.mode)}'s turn.`; return; }
    await onlineMove(row, col, selectedLetter, myOnlinePlayer);
    return;
  }
  const next = applyMoveToState(state, row, col, selectedLetter, state.currentPlayer);
  if (!next) return;
  state = next;
  render();
  if (state.mode === "ai" && state.currentPlayer === "P2" && !boardFull(state.board)) setTimeout(aiTurn, 250);
}

function findBestAIMove(board, size) {
  const empty = [];
  let best = null;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (getCell(board, size, row, col)) continue;
      empty.push([row, col]);
      for (const letter of ["S", "O"]) {
        const test = [...board];
        setCell(test, size, row, col, letter);
        const score = countSOSFromMove(test, size, row, col).count;
        if (score > 0 && (!best || score > best.score)) best = { row, col, letter, score };
      }
    }
  }
  if (best) return best;
  if (!empty.length) return null;
  const [row, col] = empty[Math.floor(Math.random() * empty.length)];
  return { row, col, letter: Math.random() > 0.5 ? "S" : "O", score: 0 };
}
function aiTurn() {
  const move = findBestAIMove(state.board, state.size);
  if (!move) return;
  const next = applyMoveToState(state, move.row, move.col, move.letter, "P2");
  if (!next) return;
  next.lastMessage = next.currentPlayer === "P2" ? `AI placed ${move.letter}, made SOS, and gets another turn.` : `AI placed ${move.letter}. Player 1's turn.`;
  state = next;
  render();
  if (state.currentPlayer === "P2" && !boardFull(state.board)) setTimeout(aiTurn, 250);
}

async function onlineMove(row, col, letter, player) {
  const ref = doc(db, "games", currentRoomId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error("Room not found.");
    const remote = normalizeRemote(snap.data());
    if (remote.currentPlayer !== player) { messageEl.textContent = `It is ${playerLabel(remote.currentPlayer, remote.mode)}'s turn.`; return; }
    if (getCell(remote.board, remote.size, row, col)) return;
    const next = applyMoveToState(remote, row, col, letter, player);
    next.updatedAt = serverTimestamp();
    await setDoc(ref, next, { merge: false });
  } catch (err) {
    messageEl.textContent = "Could not save move.";
    showDebug(err, "Could not save move");
  }
}

async function createOnlineGame() {
  const size = clampSize(boardSizeInput.value);
  const players = clampPlayers(playerCountInput.value, "online");
  const id = Math.random().toString(36).slice(2, 8);
  currentRoomId = id;
  myOnlinePlayer = "P1";
  createdThisSession = true;
  localStorage.setItem(`sos-player-${id}`, "P1");
  state = freshState(size, "online", players);
  state.lastMessage = `Online room created for ${players} players. Send the room link.`;
  state.updatedAt = serverTimestamp();
  try {
    await setDoc(doc(db, "games", id), state, { merge: false });
    history.pushState(null, "", `${location.pathname}?room=${id}`);
    listenToRoom(id);
    showGame();
    render();
    copyCurrentLink();
  } catch (err) {
    showSetupMessage("Could not create online room. Check Firebase rules.", true);
    firebaseStatus.textContent = "Firebase error";
    console.error(err);
  }
}

async function joinRoom(id) {
  currentRoomId = id;
  const ref = doc(db, "games", id);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      showGame();
      state = freshState(10, "online", 2);
      state.lastMessage = "This room does not exist. Ask Player 1 for a new link.";
      myOnlinePlayer = "";
      render();
      return;
    }
    const data = normalizeRemote(snap.data());
    const stored = localStorage.getItem(`sos-player-${id}`);
    if (stored && data.players.includes(stored)) {
      myOnlinePlayer = stored;
      state = data;
      showGame();
      listenToRoom(id);
      return;
    }
    const openPlayer = data.players.find(p => !data.joined[p]);
    if (openPlayer) {
      myOnlinePlayer = openPlayer;
      localStorage.setItem(`sos-player-${id}`, openPlayer);
      data.joined[openPlayer] = true;
      data.lastMessage = `${playerLabel(openPlayer, "online")} joined.`;
      data.updatedAt = serverTimestamp();
      await setDoc(ref, data, { merge: false });
      state = data;
      showGame();
      listenToRoom(id);
      return;
    }
    myOnlinePlayer = "";
    state = data;
    state.lastMessage = `This game already has ${state.playerCount} players. No spectator mode.`;
    showGame();
    render();
  } catch (err) {
    showGame();
    state = freshState(10, "online", 2);
    state.lastMessage = "Could not load room.";
    myOnlinePlayer = "";
    render();
    showDebug(err, "Could not load room");
  }
}
function listenToRoom(id) {
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = onSnapshot(doc(db, "games", id), (snap) => {
    if (!snap.exists()) return;
    state = normalizeRemote(snap.data());
    state.mode = "online";
    render();
  }, (err) => {
    messageEl.textContent = "Firebase sync error.";
    showDebug(err, "Firebase sync error");
  });
}
function startLocalGame() {
  const size = clampSize(boardSizeInput.value);
  const mode = modeSelect.value;
  const players = clampPlayers(playerCountInput.value, mode);
  currentRoomId = "";
  myOnlinePlayer = "";
  createdThisSession = false;
  if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
  history.pushState(null, "", location.pathname);
  state = freshState(size, mode, players);
  showGame();
  render();
}
function goBackToSetup() {
  currentRoomId = "";
  myOnlinePlayer = "";
  createdThisSession = false;
  if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
  history.pushState(null, "", location.pathname);
  showSetup();
}
function copyCurrentLink() {
  const link = currentRoomId ? `${location.origin}${location.pathname}?room=${currentRoomId}` : location.href;
  navigator.clipboard?.writeText(link).then(() => {
    messageEl.textContent = myOnlinePlayer === "P1" ? "Link copied. Send it to the other players." : "Link copied.";
  }).catch(() => {
    messageEl.textContent = "Copy failed. Manually copy the Room link shown below.";
  });
}

$("letterS").addEventListener("click", () => { selectedLetter = "S"; $("letterS").classList.add("selected"); $("letterO").classList.remove("selected"); });
$("letterO").addEventListener("click", () => { selectedLetter = "O"; $("letterO").classList.add("selected"); $("letterS").classList.remove("selected"); });
$("startGameBtn").addEventListener("click", () => { if (modeSelect.value === "online") createOnlineGame(); else startLocalGame(); });
$("createOnlineBtn").addEventListener("click", createOnlineGame);
$("newGameBtn").addEventListener("click", goBackToSetup);
$("copyLinkBtn").addEventListener("click", copyCurrentLink);
modeSelect.addEventListener("change", () => {
  playerCountInput.disabled = modeSelect.value === "ai";
  if (modeSelect.value === "ai") playerCountInput.value = "2";
});
window.addEventListener("resize", render);

firebaseStatus.textContent = "Firebase ready";
if (currentRoomId) joinRoom(currentRoomId);
else showSetup();
