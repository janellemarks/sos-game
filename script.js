/* Reliable SOS Firebase version with visible error details */
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
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  db.settings({ ignoreUndefinedProperties: true });
} catch (err) {
  showDebug("Firebase init failed", err);
}

const $ = (id) => document.getElementById(id);

const state = {
  mode: "online",
  roomId: null,
  myId: localStorage.getItem("sosDeviceId") || cryptoRandom(),
  myPlayer: null,
  size: 10,
  board: [],
  selected: "S",
  currentPlayer: "P1",
  scores: { P1: 0, P2: 0 },
  winningCells: [],
  unsubscribe: null,
  blocked: false
};
localStorage.setItem("sosDeviceId", state.myId);

const directions = [[0,1],[1,0],[1,1],[1,-1]];

window.addEventListener("load", () => {
  bindEvents();
  $("firebaseStatus").textContent = db ? "Firebase ready" : "Firebase not ready";

  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) joinRoom(room);
});

function bindEvents() {
  $("mode").addEventListener("change", e => state.mode = e.target.value);
  $("chooseS").addEventListener("click", () => chooseLetter("S"));
  $("chooseO").addEventListener("click", () => chooseLetter("O"));
  $("startLocalBtn").addEventListener("click", startLocal);
  $("createOnlineBtn").addEventListener("click", createOnlineRoom);
  $("copySetupLinkBtn").addEventListener("click", copyCurrentLink);
  $("backBtn").addEventListener("click", () => { location.href = location.pathname; });
}

function cryptoRandom() {
  if (window.crypto && crypto.getRandomValues) {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return "d" + a[0].toString(36) + a[1].toString(36);
  }
  return "d" + Math.random().toString(36).slice(2);
}

function safeSize() {
  const raw = Number($("boardSize").value);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(3, Math.min(30, Math.floor(raw)));
}

function createBoard(size) {
  return Array(size * size).fill("");
}

function startLocal() {
  state.mode = $("mode").value;
  state.size = safeSize();
  state.board = createBoard(state.size);
  state.currentPlayer = "P1";
  state.scores = { P1: 0, P2: 0 };
  state.winningCells = [];
  state.roomId = null;
  state.myPlayer = "P1";
  state.blocked = false;
  openGameScreen();
  render();
}

async function createOnlineRoom() {
  clearDebug();
  if (!db) return showSetupMessage("Firebase is not ready. Refresh and try again.");

  const size = safeSize();
  const roomId = cryptoRandom().slice(0, 7);
  const roomRef = db.collection("games").doc(roomId);
  const game = {
    size,
    board: createBoard(size),
    currentPlayer: "P1",
    scores: { P1: 0, P2: 0 },
    winningCells: [],
    player1Id: state.myId,
    player2Id: null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    await roomRef.set(game);
    const link = `${location.origin}${location.pathname}?room=${roomId}`;
    $("roomLink").textContent = link;
    $("roomBox").classList.remove("hidden");
    await navigator.clipboard?.writeText(link).catch(() => {});
    location.href = link;
  } catch (err) {
    showSetupMessage("Could not create room.");
    showDebug("Create room failed", err);
  }
}

async function joinRoom(roomId) {
  clearDebug();
  if (!db) return showGameMessage("Firebase is not ready. Refresh and try again.");

  state.roomId = roomId;
  state.mode = "online";
  state.blocked = false;
  openGameScreen();

  const roomRef = db.collection("games").doc(roomId);

  try {
    const snap = await roomRef.get();
    if (!snap.exists) {
      state.blocked = true;
      render();
      return showGameMessage("This room does not exist. Ask Player 1 to create a new link.");
    }

    const data = snap.data();

    if (data.player1Id === state.myId) {
      state.myPlayer = "P1";
    } else if (data.player2Id === state.myId) {
      state.myPlayer = "P2";
    } else if (!data.player2Id) {
      state.myPlayer = "P2";
      await roomRef.update({
        player2Id: state.myId,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      state.blocked = true;
      state.myPlayer = null;
      render();
      return showGameMessage("This room already has two players. No spectators are allowed.");
    }

    if (state.unsubscribe) state.unsubscribe();
    state.unsubscribe = roomRef.onSnapshot((doc) => {
      if (!doc.exists) {
        showGameMessage("This room was deleted.");
        return;
      }
      applyRemoteGame(doc.data());
    }, (err) => {
      showGameMessage("Could not listen to game updates.");
      showDebug("Realtime listener failed", err);
    });

  } catch (err) {
    showGameMessage("Could not join room.");
    showDebug("Join room failed", err);
  }
}

function applyRemoteGame(data) {
  state.size = data.size || 10;
  state.board = Array.isArray(data.board) ? data.board : createBoard(state.size);
  state.currentPlayer = data.currentPlayer || "P1";
  state.scores = data.scores || { P1: 0, P2: 0 };
  state.winningCells = Array.isArray(data.winningCells) ? data.winningCells : [];
  render();
}

function chooseLetter(letter) {
  state.selected = letter;
  $("chooseS").classList.toggle("active", letter === "S");
  $("chooseO").classList.toggle("active", letter === "O");
}

function openGameScreen() {
  $("setupScreen").classList.add("hidden");
  $("gameScreen").classList.remove("hidden");
}

function render() {
  $("boardTitle").textContent = `Board: ${state.size} × ${state.size}`;
  $("turnLabel").textContent = state.currentPlayer === "P1" ? "Player 1" : "Player 2";
  $("p1Score").textContent = state.scores.P1 || 0;
  $("p2Score").textContent = state.scores.P2 || 0;
  $("playerLabel").textContent = state.myPlayer ? `You are ${state.myPlayer === "P1" ? "Player 1" : "Player 2"}.` : "";
  $("deviceLabel").textContent = state.myPlayer ? `This device: ${state.myPlayer === "P1" ? "Player 1" : "Player 2"}` : "";

  const board = $("board");
  board.style.setProperty("--size", state.size);
  board.innerHTML = "";

  const winSet = new Set((state.winningCells || []).map(x => String(x)));
  for (let i = 0; i < state.size * state.size; i++) {
    const btn = document.createElement("button");
    btn.className = "cell" + (winSet.has(String(i)) ? " win" : "");
    btn.textContent = state.board[i] || "";
    btn.disabled = Boolean(state.board[i]) || state.blocked;
    btn.addEventListener("click", () => handleMove(i));
    board.appendChild(btn);
  }
}

async function handleMove(index) {
  clearDebug();

  if (state.blocked) return;
  if (state.board[index]) return;

  if (state.mode === "online") {
    if (!state.myPlayer) return showGameMessage("You are not assigned as a player in this room.");
    if (state.currentPlayer !== state.myPlayer) return showGameMessage("It is not your turn.");
  }

  const next = computeMove(index, state.selected, state.currentPlayer);

  if (state.mode === "online") {
    try {
      await db.collection("games").doc(state.roomId).update({
        board: next.board,
        currentPlayer: next.currentPlayer,
        scores: next.scores,
        winningCells: next.winningCells,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showGameMessage(next.message);
    } catch (err) {
      showGameMessage("Could not save move. See yellow error details below.");
      showDebug("Save move failed", err);
    }
  } else {
    state.board = next.board;
    state.currentPlayer = next.currentPlayer;
    state.scores = next.scores;
    state.winningCells = next.winningCells;
    render();
    showGameMessage(next.message);
    if (state.mode === "ai" && state.currentPlayer === "P2") {
      setTimeout(makeAIMove, 350);
    }
  }
}

function computeMove(index, letter, player) {
  const board = state.board.slice();
  board[index] = letter;

  const made = countSOS(board, state.size, index);
  const scores = { P1: state.scores.P1 || 0, P2: state.scores.P2 || 0 };
  let currentPlayer = player;
  const newWinCells = (state.winningCells || []).slice();

  if (made.count > 0) {
    scores[player] += made.count;
    for (const cell of made.cells) if (!newWinCells.includes(cell)) newWinCells.push(cell);
  } else {
    currentPlayer = player === "P1" ? "P2" : "P1";
  }

  let message;
  if (board.every(Boolean)) {
    message = "Game over. The board is full.";
  } else if (made.count > 0) {
    message = `${player === "P1" ? "Player 1" : "Player 2"} scored and gets another turn.`;
  } else {
    message = `${currentPlayer === "P1" ? "Player 1" : "Player 2"}'s turn.`;
  }

  return { board, currentPlayer, scores, winningCells: newWinCells, message };
}

function makeAIMove() {
  const move = findAIMove();
  if (move == null) return;
  state.selected = move.letter;
  const next = computeMove(move.index, move.letter, "P2");
  state.board = next.board;
  state.currentPlayer = next.currentPlayer;
  state.scores = next.scores;
  state.winningCells = next.winningCells;
  render();
  showGameMessage(next.message);
  if (state.currentPlayer === "P2" && !state.board.every(Boolean)) {
    setTimeout(makeAIMove, 350);
  }
}

function findAIMove() {
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i]) continue;
    for (const letter of ["S","O"]) {
      const b = state.board.slice();
      b[i] = letter;
      if (countSOS(b, state.size, i).count > 0) return { index: i, letter };
    }
  }
  const empty = state.board.map((v,i) => v ? null : i).filter(v => v !== null);
  if (!empty.length) return null;
  return { index: empty[Math.floor(Math.random() * empty.length)], letter: Math.random() > .5 ? "S" : "O" };
}

function countSOS(board, size, index) {
  const row = Math.floor(index / size);
  const col = index % size;
  let count = 0;
  const cells = [];

  for (const [dr, dc] of directions) {
    for (let offset = -2; offset <= 0; offset++) {
      let word = "";
      const line = [];

      for (let k = 0; k < 3; k++) {
        const r = row + (offset + k) * dr;
        const c = col + (offset + k) * dc;
        if (r < 0 || r >= size || c < 0 || c >= size) {
          word = "";
          break;
        }
        const idx = r * size + c;
        word += board[idx];
        line.push(idx);
      }

      if (word === "SOS") {
        count++;
        cells.push(...line);
      }
    }
  }
  return { count, cells };
}

function showSetupMessage(text) {
  $("setupMessage").textContent = text;
  $("setupMessage").classList.remove("hidden");
}
function showGameMessage(text) {
  $("gameMessage").textContent = text;
}
function showDebug(context, err) {
  const box = $("debugBox");
  if (!box) {
    console.error(context, err);
    return;
  }
  const details = [
    context,
    `name: ${err?.name || ""}`,
    `code: ${err?.code || ""}`,
    `message: ${err?.message || String(err)}`,
    `room: ${state.roomId || ""}`,
    `player: ${state.myPlayer || ""}`
  ].join("\n");
  box.textContent = details;
  box.classList.remove("hidden");
  console.error(context, err);
}
function clearDebug() {
  const box = $("debugBox");
  if (box) {
    box.textContent = "";
    box.classList.add("hidden");
  }
}
function copyCurrentLink() {
  const link = $("roomLink").textContent || location.href;
  navigator.clipboard?.writeText(link).then(() => {
    showSetupMessage("Link copied.");
  }).catch(() => {
    showSetupMessage("Copy failed. Select and copy the link manually.");
  });
}
