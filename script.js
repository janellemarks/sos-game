import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
const boardSizeInput = $("boardSizeInput");
const messageEl = $("message");
const setupMessage = $("setupMessage");
const firebaseStatus = $("firebaseStatus");

const DIRECTIONS = [[0,1], [1,0], [1,1], [1,-1]];
let state = freshState(10, "ai");
let selectedLetter = "S";
let unsubscribeRoom = null;
let currentRoomId = new URLSearchParams(location.search).get("room") || "";
let myOnlinePlayer = currentRoomId ? localStorage.getItem(`sos-player-${currentRoomId}`) || "" : "";
let applyingRemoteState = false;
let createdThisSession = false;

function clampSize(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 3), 40);
}
function indexOf(row, col, size) { return row * size + col; }
function getCell(board, size, row, col) { return board[indexOf(row, col, size)] || ""; }
function setCell(board, size, row, col, value) { board[indexOf(row, col, size)] = value; }
function inBounds(row, col, size) { return row >= 0 && row < size && col >= 0 && col < size; }
function boardFull(board) { return board.every(Boolean); }
function playerLabel(player, mode = state.mode) { return player === "P1" ? "Player 1" : mode === "ai" ? "AI" : "Player 2"; }
function makeFlatBoard(size) { return Array(size * size).fill(""); }

function freshState(size, mode) {
  return {
    version: 3,
    size,
    mode,
    board: makeFlatBoard(size),
    currentPlayer: "P1",
    scores: { P1: 0, P2: 0 },
    winningLines: [],
    player2Joined: false,
    lastMessage: "Choose S or O, then click a square.",
    updatedAt: null
  };
}

function normalizeRemote(data) {
  const size = clampSize(data?.size || 10);
  let board = data?.board;
  if (Array.isArray(board) && Array.isArray(board[0])) board = board.flat();
  if (!Array.isArray(board)) board = makeFlatBoard(size);
  if (board.length !== size * size) {
    const fixed = makeFlatBoard(size);
    for (let i = 0; i < Math.min(fixed.length, board.length); i++) fixed[i] = board[i] || "";
    board = fixed;
  }
  return {
    version: 3,
    size,
    mode: data?.mode || "online",
    board,
    currentPlayer: data?.currentPlayer === "P2" ? "P2" : "P1",
    scores: { P1: Number(data?.scores?.P1 || 0), P2: Number(data?.scores?.P2 || 0) },
    winningLines: Array.isArray(data?.winningLines) ? data.winningLines : [],
    player2Joined: Boolean(data?.player2Joined),
    lastMessage: data?.lastMessage || "Choose S or O, then click a square.",
    updatedAt: data?.updatedAt || null
  };
}

function showSetup() {
  setupScreen.classList.remove("hidden");
  gameScreen.classList.add("hidden");
}
function showGame() {
  setupScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
}
function showSetupMessage(text, isError = false) {
  setupMessage.textContent = text;
  setupMessage.classList.remove("hidden");
  setupMessage.classList.toggle("error", isError);
}

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
    next.scores[player] += result.count;
    next.winningLines = [...next.winningLines, ...result.lines];
    next.currentPlayer = player;
    next.lastMessage = `${playerLabel(player, next.mode)} made ${result.count} SOS and gets another turn.`;
  } else {
    next.currentPlayer = player === "P1" ? "P2" : "P1";
    next.lastMessage = `${playerLabel(next.currentPlayer, next.mode)}'s turn.`;
  }
  if (boardFull(next.board)) next.lastMessage = "Game over. The board is full.";
  return next;
}

function render() {
  state = normalizeRemote(state);
  applyingRemoteState = true;
  $("boardTitle").textContent = `Board: ${state.size} × ${state.size}`;
  $("scoreP1").textContent = state.scores.P1;
  $("scoreP2").textContent = state.scores.P2;
  $("p2ShortLabel").textContent = state.mode === "ai" ? "AI" : "P2";
  $("turnLabel").textContent = playerLabel(state.currentPlayer, state.mode);
  messageEl.textContent = state.lastMessage;

  let roomText = "Choose S or O, then play.";
  if (state.mode === "online") {
    roomText = myOnlinePlayer ? `You are ${playerLabel(myOnlinePlayer, state.mode)}.` : "Room full.";
  }
  $("roomStatus").textContent = roomText;
  $("playerLabel").textContent = state.mode === "online" && myOnlinePlayer ? `This device: ${playerLabel(myOnlinePlayer, state.mode)}` : "";

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
      btn.disabled = Boolean(value) || boardFull(state.board) ||
        (state.mode === "online" && (!myOnlinePlayer || state.currentPlayer !== myOnlinePlayer)) ||
        (state.mode === "ai" && state.currentPlayer === "P2");
      btn.addEventListener("click", () => handleCellClick(row, col));
      boardEl.appendChild(btn);
    }
  }
  applyingRemoteState = false;
}

async function handleCellClick(row, col) {
  if (state.mode === "online" && currentRoomId) {
    if (!myOnlinePlayer) { messageEl.textContent = "This room already has 2 players."; return; }
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
  for (const [row, col] of empty) {
    for (const letter of ["S", "O"]) {
      const test = [...board];
      setCell(test, size, row, col, letter);
      if (countSOSFromMove(test, size, row, col).count > 0) return { row, col, letter, score: 0 };
    }
  }
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
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("Room not found.");
      const remote = normalizeRemote(snap.data());
      if (remote.currentPlayer !== player) return;
      if (getCell(remote.board, remote.size, row, col)) return;
      const next = applyMoveToState(remote, row, col, letter, player);
      next.updatedAt = serverTimestamp();
      transaction.set(ref, next, { merge: true });
    });
  } catch (err) {
    console.error(err);
    messageEl.textContent = "Could not save move. Check internet/Firebase rules.";
  }
}

async function createOnlineGame() {
  const size = clampSize(boardSizeInput.value);
  const id = Math.random().toString(36).slice(2, 8);
  currentRoomId = id;
  myOnlinePlayer = "P1";
  createdThisSession = true;
  localStorage.setItem(`sos-player-${id}`, "P1");
  state = freshState(size, "online");
  state.lastMessage = "Online room created. Send the room link to Player 2.";
  state.updatedAt = serverTimestamp();
  try {
    await setDoc(doc(db, "games", id), state);
    history.pushState(null, "", `${location.pathname}?room=${id}`);
    listenToRoom(id);
    showGame();
    render();
    copyCurrentLink();
  } catch (err) {
    console.error(err);
    showSetupMessage("Could not create online room. Check Firebase rules.", true);
    firebaseStatus.textContent = "Firebase error";
  }
}

async function joinRoom(id) {
  currentRoomId = id;
  const ref = doc(db, "games", id);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      showGame();
      state = freshState(10, "online");
      state.lastMessage = "This room does not exist. Ask Player 1 for a new link.";
      myOnlinePlayer = "";
      render();
      return;
    }
    const data = normalizeRemote(snap.data());
    const stored = localStorage.getItem(`sos-player-${id}`);
    if (stored === "P1" || stored === "P2") {
      myOnlinePlayer = stored;
      state = data;
      showGame();
      listenToRoom(id);
      return;
    }

    if (!data.player2Joined) {
      myOnlinePlayer = "P2";
      localStorage.setItem(`sos-player-${id}`, "P2");
      await updateDoc(ref, { player2Joined: true });
      state = data;
      state.player2Joined = true;
      showGame();
      listenToRoom(id);
      return;
    }

    myOnlinePlayer = "";
    state = data;
    state.lastMessage = "This online game already has 2 players.";
    showGame();
    render();
  } catch (err) {
    console.error(err);
    showGame();
    state = freshState(10, "online");
    state.lastMessage = "Could not load room. Check internet/Firebase rules.";
    myOnlinePlayer = "";
    render();
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
    console.error(err);
    messageEl.textContent = "Firebase sync error. Check Firestore rules.";
  });
}
function startLocalGame() {
  const size = clampSize(boardSizeInput.value);
  currentRoomId = "";
  myOnlinePlayer = "";
  createdThisSession = false;
  if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
  history.pushState(null, "", location.pathname);
  state = freshState(size, modeSelect.value);
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
    messageEl.textContent = "Link copied. Send it to Player 2.";
  }).catch(() => {
    messageEl.textContent = "Copy failed. Manually copy the Room link shown below.";
  });
}

$("letterS").addEventListener("click", () => { selectedLetter = "S"; $("letterS").classList.add("selected"); $("letterO").classList.remove("selected"); });
$("letterO").addEventListener("click", () => { selectedLetter = "O"; $("letterO").classList.add("selected"); $("letterS").classList.remove("selected"); });
$("startGameBtn").addEventListener("click", () => {
  if (modeSelect.value === "online") createOnlineGame();
  else startLocalGame();
});
$("createOnlineBtn").addEventListener("click", createOnlineGame);
$("newGameBtn").addEventListener("click", goBackToSetup);
$("copyLinkBtn").addEventListener("click", copyCurrentLink);
window.addEventListener("resize", render);

firebaseStatus.textContent = "Firebase ready";
if (currentRoomId) joinRoom(currentRoomId);
else showSetup();
