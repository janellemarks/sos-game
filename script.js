/* SOS Game with Firebase online rooms. No build tools needed. */
const firebaseConfig = {
  apiKey: "AIzaSyDDWZULdUu_7x6PG8ggSWiODMKeHK0ddj8",
  authDomain: "sos-game-78831.firebaseapp.com",
  projectId: "sos-game-78831",
  storageBucket: "sos-game-78831.firebasestorage.app",
  messagingSenderId: "131969888495",
  appId: "1:131969888495:web:114dfb000736969e71eb1a",
  measurementId: "G-KKS99RC8BL"
};

let db = null;
let unsubscribeRoom = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  document.getElementById("firebaseStatus").textContent = "Firebase ready";
} catch (error) {
  document.getElementById("firebaseStatus").textContent = "Firebase error";
  console.error(error);
}

const DIRS = [[0,1],[1,0],[1,1],[1,-1]];
let boardSize = 12;
let board = createBoard(boardSize);
let selectedLetter = "S";
let mode = "ai";
let currentPlayer = "P1";
let scores = { P1: 0, P2: 0 };
let winningCells = new Set();
let roomId = new URLSearchParams(location.search).get("room") || "";
let myPlayer = "P1";
let applyingRemote = false;

const el = {
  board: document.getElementById("board"),
  boardTitle: document.getElementById("boardTitle"),
  mode: document.getElementById("mode"),
  boardSize: document.getElementById("boardSize"),
  chooseS: document.getElementById("chooseS"),
  chooseO: document.getElementById("chooseO"),
  newGame: document.getElementById("newGame"),
  createRoom: document.getElementById("createRoom"),
  copyLink: document.getElementById("copyLink"),
  message: document.getElementById("message"),
  scoreP1: document.getElementById("scoreP1"),
  scoreP2: document.getElementById("scoreP2"),
  p2Label: document.getElementById("p2Label"),
  turnLabel: document.getElementById("turnLabel"),
  roomBox: document.getElementById("roomBox"),
  roomLink: document.getElementById("roomLink")
};

function createBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ""));
}
function cloneBoard(b) { return b.map(row => [...row]); }
function inBounds(r,c,size) { return r >= 0 && r < size && c >= 0 && c < size; }
function playerLabel(p) { return p === "P1" ? "Player 1" : (mode === "ai" ? "AI" : "Player 2"); }
function boardIsFull(b) { return b.every(row => row.every(cell => cell)); }

function countSOSFromMove(b, row, col) {
  const size = b.length;
  let count = 0;
  const lines = [];
  for (const [dr, dc] of DIRS) {
    for (let offset = -2; offset <= 0; offset++) {
      let word = "";
      const cells = [];
      for (let i = 0; i < 3; i++) {
        const r = row + (offset + i) * dr;
        const c = col + (offset + i) * dc;
        if (!inBounds(r,c,size)) { word = ""; break; }
        word += b[r][c];
        cells.push([r,c]);
      }
      if (word === "SOS") { count++; lines.push(cells); }
    }
  }
  return { count, lines };
}

function render() {
  el.boardTitle.textContent = `Board: ${boardSize} × ${boardSize}`;
  el.scoreP1.textContent = scores.P1;
  el.scoreP2.textContent = scores.P2;
  el.p2Label.textContent = mode === "ai" ? "AI" : "Player 2";
  el.turnLabel.textContent = playerLabel(currentPlayer);
  el.board.style.gridTemplateColumns = `repeat(${boardSize}, 42px)`;
  el.board.innerHTML = "";

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell";
      btn.textContent = board[r][c];
      if (board[r][c]) btn.classList.add("filled");
      if (winningCells.has(`${r}-${c}`)) btn.classList.add("win");
      btn.addEventListener("click", () => handleCellClick(r, c));
      el.board.appendChild(btn);
    }
  }
}

function setMessage(text) { el.message.textContent = text; }
function addWinningLines(lines) {
  for (const line of lines) for (const [r,c] of line) winningCells.add(`${r}-${c}`);
}

async function saveRoom() {
  if (!db || !roomId || mode !== "online" || applyingRemote) return;
  await db.collection("games").doc(roomId).set({
    boardSize, board, currentPlayer, scores,
    winningCells: Array.from(winningCells),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

function applyMove(row, col, letter, player) {
  if (board[row][col]) return false;
  board[row][col] = letter;
  const result = countSOSFromMove(board, row, col);
  if (result.count > 0) {
    scores[player] += result.count;
    addWinningLines(result.lines);
    setMessage(`${playerLabel(player)} made ${result.count} SOS and gets another turn.`);
  } else {
    currentPlayer = player === "P1" ? "P2" : "P1";
    setMessage(`${playerLabel(currentPlayer)}'s turn.`);
  }
  if (boardIsFull(board)) setMessage("Game over. The board is full.");
  render();
  saveRoom();
  return result.count > 0;
}

function handleCellClick(row, col) {
  if (board[row][col]) return;
  if (mode === "online" && currentPlayer !== myPlayer) {
    setMessage(`Wait. It is ${playerLabel(currentPlayer)}'s turn.`);
    return;
  }
  if (mode === "ai" && currentPlayer === "P2") return;

  const scored = applyMove(row, col, selectedLetter, currentPlayer);
  if (mode === "ai" && currentPlayer === "P2" && !boardIsFull(board)) {
    setTimeout(makeAIMove, 300);
  }
}

function findBestAIMove() {
  const empty = [];
  let best = null;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c]) continue;
      empty.push([r,c]);
      for (const letter of ["S","O"]) {
        const test = cloneBoard(board);
        test[r][c] = letter;
        const score = countSOSFromMove(test, r, c).count;
        if (score > 0 && (!best || score > best.score)) best = { r, c, letter, score };
      }
    }
  }
  if (best) return best;
  for (const [r,c] of empty) {
    for (const letter of ["S","O"]) {
      const test = cloneBoard(board);
      test[r][c] = letter;
      if (countSOSFromMove(test, r, c).count > 0) return { r, c, letter, score: 0 };
    }
  }
  if (!empty.length) return null;
  const [r,c] = empty[Math.floor(Math.random() * empty.length)];
  return { r, c, letter: Math.random() > 0.5 ? "S" : "O", score: 0 };
}

function makeAIMove() {
  const move = findBestAIMove();
  if (!move) return;
  applyMove(move.r, move.c, move.letter, "P2");
  if (currentPlayer === "P2" && !boardIsFull(board)) setTimeout(makeAIMove, 300);
}

function newGame(size = Number(el.boardSize.value) || 12) {
  boardSize = Math.max(3, Math.min(60, Math.floor(size)));
  el.boardSize.value = boardSize;
  board = createBoard(boardSize);
  scores = { P1: 0, P2: 0 };
  currentPlayer = "P1";
  winningCells = new Set();
  setMessage("Choose S or O, then click a square.");
  render();
  saveRoom();
}

async function createOnlineRoom() {
  if (!db) { setMessage("Firebase is not ready yet. Refresh and try again."); return; }
  mode = "online";
  el.mode.value = "online";
  roomId = Math.random().toString(36).slice(2, 9);
  myPlayer = "P1";
  newGame(Number(el.boardSize.value) || 12);
  const link = `${location.origin}${location.pathname}?room=${roomId}`;
  el.roomBox.hidden = false;
  el.roomLink.textContent = link;
  await saveRoom();
  listenToRoom();
  try { await navigator.clipboard.writeText(link); } catch (e) {}
  setMessage("Online room created. Link copied. Send it to your friend.");
}

async function listenToRoom() {
  if (!db || !roomId) return;
  if (unsubscribeRoom) unsubscribeRoom();
  mode = "online";
  el.mode.value = "online";
  const link = `${location.origin}${location.pathname}?room=${roomId}`;
  el.roomBox.hidden = false;
  el.roomLink.textContent = link;

  unsubscribeRoom = db.collection("games").doc(roomId).onSnapshot(async doc => {
    if (!doc.exists) {
      myPlayer = "P2";
      await saveRoom();
      return;
    }
    applyingRemote = true;
    const data = doc.data();
    boardSize = data.boardSize || boardSize;
    board = data.board || board;
    currentPlayer = data.currentPlayer || currentPlayer;
    scores = data.scores || scores;
    winningCells = new Set(data.winningCells || []);
    el.boardSize.value = boardSize;
    render();
    applyingRemote = false;
  }, error => {
    console.error(error);
    setMessage("Could not load online room. Check Firestore rules.");
  });

  setMessage(myPlayer === "P1" ? "You are Player 1. Share this link." : "You joined as Player 2.");
}

el.chooseS.addEventListener("click", () => { selectedLetter = "S"; el.chooseS.classList.add("selected"); el.chooseO.classList.remove("selected"); });
el.chooseO.addEventListener("click", () => { selectedLetter = "O"; el.chooseO.classList.add("selected"); el.chooseS.classList.remove("selected"); });
el.newGame.addEventListener("click", () => newGame());
el.createRoom.addEventListener("click", createOnlineRoom);
el.copyLink.addEventListener("click", async () => {
  const link = roomId ? `${location.origin}${location.pathname}?room=${roomId}` : location.href;
  try { await navigator.clipboard.writeText(link); setMessage("Link copied."); } catch (e) { setMessage(link); }
});
el.mode.addEventListener("change", () => {
  mode = el.mode.value;
  if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
  if (mode !== "online") roomId = "";
  el.roomBox.hidden = mode !== "online" || !roomId;
  newGame();
});

if (roomId) {
  myPlayer = "P2";
  listenToRoom();
} else {
  render();
}
