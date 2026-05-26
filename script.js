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
const messageEl = $("message");
const debugEl = $("debug");
const scoreWrap = $("scoreWrap");
const params = new URLSearchParams(window.location.search);
let roomId = params.get("room");
let myId = localStorage.getItem("sosDeviceId");
if (!myId) {
  myId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem("sosDeviceId", myId);
}

let selectedLetter = "S";
let state = null;
let myPlayer = null;

const dirs = [[0,1],[1,0],[1,1],[1,-1]];

function emptyBoard(size) { return Array(size * size).fill(""); }
function idx(r,c,size) { return r * size + c; }
function inside(r,c,size) { return r >= 0 && r < size && c >= 0 && c < size; }
function playerKey(n) { return `P${n}`; }
function label(p) { return p ? p.replace("P", "Player ") : "-"; }
function nextPlayer(current, playerCount) {
  const n = Number(current.replace("P", ""));
  return `P${(n % playerCount) + 1}`;
}
function showMessage(text) { messageEl.textContent = text; messageEl.classList.toggle("hidden", !text); }
function showDebug(text) { debugEl.textContent = text; debugEl.classList.toggle("hidden", !text); }
function roomRef(id = roomId) { return doc(db, "games", id); }
function roomUrl(id = roomId) { return `${window.location.origin}${window.location.pathname}?room=${id}`; }

function findSOS(board, size, row, col) {
  let count = 0;
  const winLines = []; // Firebase-safe strings only, e.g. "0,0|0,1|0,2"
  for (const [dr, dc] of dirs) {
    for (let offset = -2; offset <= 0; offset++) {
      let word = "";
      const cells = [];
      for (let i = 0; i < 3; i++) {
        const r = row + (offset + i) * dr;
        const c = col + (offset + i) * dc;
        if (!inside(r, c, size)) { word = ""; break; }
        word += board[idx(r,c,size)] || "";
        cells.push(`${r},${c}`);
      }
      if (word === "SOS") {
        count++;
        winLines.push(cells.join("|"));
      }
    }
  }
  return { count, winLines };
}

function winCellSet(lines) {
  const s = new Set();
  (lines || []).forEach(line => String(line).split("|").forEach(cell => s.add(cell)));
  return s;
}

function currentPlayerFromState(st) {
  return st?.currentPlayer || "P1";
}

function getMyPlayer(st) {
  const players = st.players || {};
  for (let i = 1; i <= st.playerCount; i++) {
    if (players[playerKey(i)] === myId) return playerKey(i);
  }
  return null;
}

async function claimSeat(st) {
  const players = { ...(st.players || {}) };
  for (let i = 1; i <= st.playerCount; i++) {
    const key = playerKey(i);
    if (!players[key]) {
      players[key] = myId;
      const updated = { ...st, players, updatedAt: serverTimestamp() };
      await setDoc(roomRef(), updated, { merge: true });
      return key;
    }
  }
  return null;
}

function render(st) {
  state = st;
  setupScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");

  myPlayer = getMyPlayer(st);
  const full = Object.values(st.players || {}).filter(Boolean).length >= st.playerCount;
  if (!myPlayer && full) {
    $("playerStatus").textContent = "This room is full.";
    showMessage("This game already has the maximum number of players.");
  } else {
    $("playerStatus").textContent = myPlayer ? `You are ${label(myPlayer)}.` : "Joining room...";
  }

  $("turnLabel").textContent = label(currentPlayerFromState(st));
  $("deviceLabel").textContent = myPlayer ? `This device: ${label(myPlayer)}` : "";
  $("boardTitle").textContent = `Board: ${st.size} × ${st.size}`;
  $("roomLinkBox").textContent = `Room link: ${roomUrl()}`;
  $("roomLinkBox").classList.remove("hidden");

  scoreWrap.innerHTML = "";
  for (let i = 1; i <= st.playerCount; i++) {
    const p = playerKey(i);
    const div = document.createElement("div");
    div.className = "score";
    div.innerHTML = `${label(p)} <strong>${st.scores?.[p] || 0}</strong>`;
    scoreWrap.appendChild(div);
  }

  const wins = winCellSet(st.winLines || []);
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${st.size}, 34px)`;
  if (window.innerWidth <= 760) boardEl.style.gridTemplateColumns = `repeat(${st.size}, 44px)`;

  for (let r = 0; r < st.size; r++) {
    for (let c = 0; c < st.size; c++) {
      const b = document.createElement("button");
      b.className = "cell" + (wins.has(`${r},${c}`) ? " win" : "");
      b.textContent = st.board[idx(r,c,st.size)] || "";
      b.disabled = Boolean(b.textContent) || !myPlayer || myPlayer !== currentPlayerFromState(st);
      b.addEventListener("click", () => saveMove(r,c));
      boardEl.appendChild(b);
    }
  }
}

async function saveMove(r, c) {
  if (!state || !myPlayer) return;
  showDebug("");
  if (myPlayer !== currentPlayerFromState(state)) {
    showMessage("It is not your turn yet.");
    return;
  }
  const position = idx(r,c,state.size);
  if (state.board[position]) return;

  const newBoard = [...state.board];
  newBoard[position] = selectedLetter;
  const made = findSOS(newBoard, state.size, r, c);
  const newScores = { ...(state.scores || {}) };
  newScores[myPlayer] = (newScores[myPlayer] || 0) + made.count;
  const newLines = [...(state.winLines || []), ...made.winLines];
  const newTurn = made.count > 0 ? myPlayer : nextPlayer(myPlayer, state.playerCount);

  const updated = {
    ...state,
    board: newBoard,              // flat array only
    scores: newScores,            // object, not nested array
    winLines: newLines,           // array of strings only
    currentPlayer: newTurn,
    updatedAt: serverTimestamp(),
    lastMove: { row: r, col: c, letter: selectedLetter, player: myPlayer, score: made.count }
  };

  try {
    await setDoc(roomRef(), updated, { merge: false });
    showMessage(made.count > 0 ? `${label(myPlayer)} scored ${made.count}! Go again.` : `${label(newTurn)}'s turn.`);
  } catch (err) {
    showMessage("Could not save move.");
    showDebug(`${err.code || "error"}: ${err.message || String(err)}`);
  }
}

function newRoomId() { return Math.random().toString(36).slice(2, 8); }
async function createRoom() {
  const size = Math.max(3, Math.min(30, parseInt($("setupBoardSize").value || "10", 10)));
  const playerCount = Math.max(2, Math.min(4, parseInt($("setupPlayerCount").value || "2", 10)));
  const id = newRoomId();
  const players = { P1: myId };
  for (let i = 2; i <= playerCount; i++) players[playerKey(i)] = "";
  const scores = {};
  for (let i = 1; i <= playerCount; i++) scores[playerKey(i)] = 0;
  const st = {
    version: 8,
    size,
    playerCount,
    board: emptyBoard(size),
    players,
    scores,
    currentPlayer: "P1",
    winLines: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(roomRef(id), st);
    window.location.href = roomUrl(id);
  } catch (err) {
    $("setupStatus").textContent = `${err.code || "error"}: ${err.message || String(err)}`;
  }
}

async function start() {
  $("letterS").addEventListener("click", () => { selectedLetter = "S"; $("letterS").classList.add("selected"); $("letterO").classList.remove("selected"); });
  $("letterO").addEventListener("click", () => { selectedLetter = "O"; $("letterO").classList.add("selected"); $("letterS").classList.remove("selected"); });
  $("createRoomBtn").addEventListener("click", createRoom);
  $("copyLinkBtn").addEventListener("click", async () => { await navigator.clipboard.writeText(roomUrl()); showMessage("Link copied."); });
  $("newGameBtn").addEventListener("click", () => { window.location.href = window.location.pathname; });

  if (!roomId) {
    setupScreen.classList.remove("hidden");
    gameScreen.classList.add("hidden");
    return;
  }

  setupScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  showMessage("Loading room...");

  const snap = await getDoc(roomRef());
  if (!snap.exists()) {
    showMessage("Room not found. Create a new game.");
    return;
  }
  let st = snap.data();
  if (!getMyPlayer(st)) {
    try { await claimSeat(st); } catch (err) { showDebug(`${err.code || "error"}: ${err.message || String(err)}`); }
  }
  onSnapshot(roomRef(), (docSnap) => {
    if (!docSnap.exists()) { showMessage("Room not found."); return; }
    showMessage("");
    render(docSnap.data());
  }, (err) => {
    showMessage("Could not connect to Firebase.");
    showDebug(`${err.code || "error"}: ${err.message || String(err)}`);
  });
}

start();
