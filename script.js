import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
const boardEl = $("board");
const modeSelect = $("modeSelect");
const boardSizeInput = $("boardSizeInput");
const messageEl = $("message");
const firebaseStatus = $("firebaseStatus");

let state = freshState(10, "ai");
let selectedLetter = "S";
let unsubscribeRoom = null;
let currentRoomId = new URLSearchParams(location.search).get("room") || "";
let myOnlinePlayer = localStorage.getItem(`sos-player-${currentRoomId}`) || "";
let applyingRemoteState = false;

const DIRECTIONS = [[0,1], [1,0], [1,1], [1,-1]];

function freshState(size, mode) {
  return {
    size,
    mode,
    board: Array.from({ length: size }, () => Array(size).fill("")),
    currentPlayer: "P1",
    scores: { P1: 0, P2: 0 },
    winningLines: [],
    lastMessage: "Choose S or O, then click a square.",
    updatedAt: null
  };
}

function cloneBoard(board) { return board.map(row => [...row]); }
function inBounds(r, c, size) { return r >= 0 && r < size && c >= 0 && c < size; }
function label(player) {
  if (player === "P1") return "Player 1";
  if (state.mode === "ai") return "AI";
  return "Player 2";
}
function boardFull(board) { return board.every(row => row.every(Boolean)); }

function countSOSFromMove(board, row, col) {
  const size = board.length;
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
        word += board[r][c];
        cells.push([r, c]);
      }
      if (word === "SOS") { count++; lines.push(cells); }
    }
  }
  return { count, lines };
}

function applyMoveToState(base, row, col, letter, player) {
  if (!base || !base.board || base.board[row]?.[col]) return null;
  const next = JSON.parse(JSON.stringify(base));
  next.board[row][col] = letter;
  const result = countSOSFromMove(next.board, row, col);
  if (!next.scores) next.scores = { P1: 0, P2: 0 };
  if (!next.winningLines) next.winningLines = [];

  if (result.count > 0) {
    next.scores[player] = (next.scores[player] || 0) + result.count;
    next.winningLines = [...next.winningLines, ...result.lines];
    next.currentPlayer = player;
    next.lastMessage = `${labelWithMode(player, next.mode)} made ${result.count} SOS and gets another turn.`;
  } else {
    next.currentPlayer = player === "P1" ? "P2" : "P1";
    next.lastMessage = `${labelWithMode(next.currentPlayer, next.mode)}'s turn.`;
  }

  if (boardFull(next.board)) next.lastMessage = "Game over. The board is full.";
  return next;
}

function labelWithMode(player, mode) {
  if (player === "P1") return "Player 1";
  return mode === "ai" ? "AI" : "Player 2";
}

function render() {
  applyingRemoteState = true;
  modeSelect.value = state.mode || "ai";
  boardSizeInput.value = state.size;
  $("boardTitle").textContent = `Board: ${state.size} × ${state.size}`;
  $("scoreP1").textContent = state.scores?.P1 || 0;
  $("scoreP2").textContent = state.scores?.P2 || 0;
  $("p2Label").textContent = state.mode === "ai" ? "AI" : "Player 2";
  $("turnLabel").textContent = label(state.currentPlayer);
  messageEl.textContent = state.lastMessage || "Choose S or O, then click a square.";
  $("youAreLabel").textContent = state.mode === "online" ? (myOnlinePlayer ? label(myOnlinePlayer) : "Spectator") : "This device";

  if (currentRoomId) {
    $("roomBox").classList.remove("hidden");
    $("roomLink").textContent = location.origin + location.pathname + "?room=" + currentRoomId;
  } else {
    $("roomBox").classList.add("hidden");
  }

  const winCells = new Set();
  (state.winningLines || []).forEach(line => line.forEach(([r,c]) => winCells.add(`${r}-${c}`)));

  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${state.size}, 36px)`;
  if (innerWidth <= 760) boardEl.style.gridTemplateColumns = `repeat(${state.size}, 44px)`;

  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const btn = document.createElement("button");
      btn.className = "cell" + (winCells.has(`${r}-${c}`) ? " win" : "");
      btn.textContent = state.board[r][c] || "";
      btn.disabled = Boolean(state.board[r][c]) || boardFull(state.board) || (state.mode === "online" && myOnlinePlayer && state.currentPlayer !== myOnlinePlayer) || (state.mode === "ai" && state.currentPlayer === "P2");
      btn.addEventListener("click", () => handleCellClick(r, c));
      boardEl.appendChild(btn);
    }
  }
  applyingRemoteState = false;
}

async function handleCellClick(row, col) {
  if (state.mode === "online" && currentRoomId) {
    if (!myOnlinePlayer) { messageEl.textContent = "This device is a spectator for this room."; return; }
    if (state.currentPlayer !== myOnlinePlayer) { messageEl.textContent = `It is ${label(state.currentPlayer)}'s turn.`; return; }
    await onlineMove(row, col, selectedLetter, myOnlinePlayer);
    return;
  }

  const player = state.currentPlayer;
  const next = applyMoveToState(state, row, col, selectedLetter, player);
  if (!next) return;
  state = next;
  render();

  if (state.mode === "ai" && state.currentPlayer === "P2" && !boardFull(state.board)) {
    setTimeout(aiTurn, 250);
  }
}

function findBestAIMove(board) {
  const empty = [];
  let best = null;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board.length; c++) {
      if (board[r][c]) continue;
      empty.push([r,c]);
      for (const letter of ["S", "O"]) {
        const test = cloneBoard(board);
        test[r][c] = letter;
        const score = countSOSFromMove(test, r, c).count;
        if (score > 0 && (!best || score > best.score)) best = { row:r, col:c, letter, score };
      }
    }
  }
  if (best) return best;
  for (const [r,c] of empty) {
    for (const letter of ["S", "O"]) {
      const test = cloneBoard(board);
      test[r][c] = letter;
      if (countSOSFromMove(test, r, c).count > 0) return { row:r, col:c, letter, score:0 };
    }
  }
  if (!empty.length) return null;
  const [row, col] = empty[Math.floor(Math.random() * empty.length)];
  return { row, col, letter: Math.random() > .5 ? "S" : "O", score:0 };
}

function aiTurn() {
  const move = findBestAIMove(state.board);
  if (!move) return;
  const next = applyMoveToState(state, move.row, move.col, move.letter, "P2");
  if (!next) return;
  if (next.lastMessage.includes("made")) next.lastMessage = `AI placed ${move.letter}, made SOS, and gets another turn.`;
  else next.lastMessage = `AI placed ${move.letter}. Player 1's turn.`;
  state = next;
  render();
  if (state.currentPlayer === "P2" && !boardFull(state.board)) setTimeout(aiTurn, 250);
}

async function onlineMove(row, col, letter, player) {
  const ref = doc(db, "games", currentRoomId);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error("Room not found.");
    const remote = snap.data();
    if (remote.currentPlayer !== player) return;
    if (remote.board?.[row]?.[col]) return;
    const next = applyMoveToState(remote, row, col, letter, player);
    if (!next) return;
    next.updatedAt = serverTimestamp();
    transaction.set(ref, next, { merge: true });
  }).catch(err => {
    console.error(err);
    messageEl.textContent = "Could not save move. Check Firebase rules or internet connection.";
  });
}

async function createOnlineGame() {
  const size = clampSize(boardSizeInput.value);
  const id = Math.random().toString(36).slice(2, 8);
  currentRoomId = id;
  myOnlinePlayer = "P1";
  localStorage.setItem(`sos-player-${id}`, "P1");
  state = freshState(size, "online");
  state.lastMessage = "Online room created. Send the room link to Player 2.";
  state.updatedAt = serverTimestamp();
  await setDoc(doc(db, "games", id), state);
  history.pushState(null, "", `${location.pathname}?room=${id}`);
  listenToRoom(id);
  render();
  copyCurrentLink();
}

async function joinRoom(id) {
  currentRoomId = id;
  const ref = doc(db, "games", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    firebaseStatus.textContent = "Room not found";
    state = freshState(10, "online");
    state.lastMessage = "This room does not exist. Create a new online game link.";
    render();
    return;
  }

  const stored = localStorage.getItem(`sos-player-${id}`);
  const data = snap.data();
  if (stored) {
    myOnlinePlayer = stored;
  } else if (!data.player2Joined) {
    myOnlinePlayer = "P2";
    localStorage.setItem(`sos-player-${id}`, "P2");
    await updateDoc(ref, { player2Joined: true });
  } else {
    myOnlinePlayer = "";
  }
  listenToRoom(id);
}

function listenToRoom(id) {
  if (unsubscribeRoom) unsubscribeRoom();
  firebaseStatus.textContent = "Firebase ready";
  unsubscribeRoom = onSnapshot(doc(db, "games", id), (snap) => {
    if (!snap.exists()) return;
    state = snap.data();
    state.mode = "online";
    render();
  }, (err) => {
    console.error(err);
    firebaseStatus.textContent = "Firebase error";
    messageEl.textContent = "Firebase sync error. Check Firestore rules.";
  });
}

function clampSize(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 3), 40);
}

function newLocalGame() {
  const size = clampSize(boardSizeInput.value);
  currentRoomId = "";
  myOnlinePlayer = "";
  if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
  history.pushState(null, "", location.pathname);
  state = freshState(size, modeSelect.value);
  render();
}

function copyCurrentLink() {
  const link = currentRoomId ? `${location.origin}${location.pathname}?room=${currentRoomId}` : location.href;
  navigator.clipboard?.writeText(link).then(() => {
    messageEl.textContent = "Link copied. Send it to the other player.";
  }).catch(() => {
    messageEl.textContent = "Copy failed. You can manually copy the Room link shown below.";
  });
}

$("letterS").addEventListener("click", () => {
  selectedLetter = "S";
  $("letterS").classList.add("selected");
  $("letterO").classList.remove("selected");
});
$("letterO").addEventListener("click", () => {
  selectedLetter = "O";
  $("letterO").classList.add("selected");
  $("letterS").classList.remove("selected");
});
$("newGameBtn").addEventListener("click", newLocalGame);
$("createOnlineBtn").addEventListener("click", createOnlineGame);
$("copyLinkBtn").addEventListener("click", copyCurrentLink);
modeSelect.addEventListener("change", () => {
  if (!applyingRemoteState) newLocalGame();
});
window.addEventListener("resize", render);

firebaseStatus.textContent = "Firebase ready";
if (currentRoomId) {
  modeSelect.value = "online";
  joinRoom(currentRoomId);
} else {
  render();
}
