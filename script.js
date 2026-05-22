import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
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

const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];

const state = {
  boardSize: 12,
  board: [],
  selectedLetter: "S",
  mode: "ai",
  currentPlayer: "P1",
  scores: { P1: 0, P2: 0 },
  winningCells: new Set(),
  roomId: null,
  myPlayer: null,
  unsubscribeRoom: null,
  applyingRemoteUpdate: false
};

const boardEl = document.getElementById("board");
const boardSizeInput = document.getElementById("boardSizeInput");
const modeSelect = document.getElementById("modeSelect");
const chooseS = document.getElementById("chooseS");
const chooseO = document.getElementById("chooseO");
const newGameButton = document.getElementById("newGameButton");
const createRoomButton = document.getElementById("createRoomButton");
const copyLinkButton = document.getElementById("copyLinkButton");
const messageBox = document.getElementById("messageBox");
const scoreP1 = document.getElementById("scoreP1");
const scoreP2 = document.getElementById("scoreP2");
const player2Label = document.getElementById("player2Label");
const turnLabel = document.getElementById("turnLabel");
const boardTitle = document.getElementById("boardTitle");
const shareBox = document.getElementById("shareBox");
const shareLink = document.getElementById("shareLink");
const connectionStatus = document.getElementById("connectionStatus");
const roomInfo = document.getElementById("roomInfo");

function createBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ""));
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function inBounds(row, col, size) {
  return row >= 0 && row < size && col >= 0 && col < size;
}

function boardIsFull(board) {
  return board.every((row) => row.every((cell) => cell !== ""));
}

function countSOSFromMove(board, row, col) {
  const size = board.length;
  let count = 0;
  const lines = [];

  for (const [dr, dc] of DIRECTIONS) {
    for (let offset = -2; offset <= 0; offset += 1) {
      let word = "";
      const cells = [];

      for (let i = 0; i < 3; i += 1) {
        const r = row + (offset + i) * dr;
        const c = col + (offset + i) * dc;

        if (!inBounds(r, c, size)) {
          word = "";
          break;
        }

        word += board[r][c];
        cells.push([r, c]);
      }

      if (word === "SOS") {
        count += 1;
        lines.push(cells);
      }
    }
  }

  return { count, lines };
}

function rebuildWinningCells() {
  state.winningCells = new Set();

  for (let row = 0; row < state.board.length; row += 1) {
    for (let col = 0; col < state.board.length; col += 1) {
      if (!state.board[row][col]) continue;
      const result = countSOSFromMove(state.board, row, col);
      for (const line of result.lines) {
        for (const [r, c] of line) {
          state.winningCells.add(`${r}-${c}`);
        }
      }
    }
  }
}

function getPlayerLabel(player) {
  if (player === "P1") return "Player 1";
  if (state.mode === "ai") return "AI";
  return "Player 2";
}

function showMessage(text) {
  messageBox.textContent = text;
}

function render() {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${state.boardSize}, minmax(30px, 1fr))`;

  for (let row = 0; row < state.boardSize; row += 1) {
    for (let col = 0; col < state.boardSize; col += 1) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.textContent = state.board[row][col];

      if (state.winningCells.has(`${row}-${col}`)) {
        cell.classList.add("win");
      }

      cell.disabled = Boolean(state.board[row][col]) || !canCurrentUserPlay();
      cell.addEventListener("click", () => handleCellClick(row, col));
      boardEl.appendChild(cell);
    }
  }

  scoreP1.textContent = state.scores.P1;
  scoreP2.textContent = state.scores.P2;
  player2Label.textContent = state.mode === "ai" ? "AI" : "Player 2";
  turnLabel.textContent = getPlayerLabel(state.currentPlayer);
  boardTitle.textContent = `Board: ${state.boardSize} × ${state.boardSize}`;

  chooseS.classList.toggle("active", state.selectedLetter === "S");
  chooseO.classList.toggle("active", state.selectedLetter === "O");

  modeSelect.value = state.mode;
  boardSizeInput.value = state.boardSize;

  if (state.roomId) {
    const link = `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;
    shareBox.hidden = false;
    shareLink.href = link;
    shareLink.textContent = link;
    connectionStatus.textContent = "Online room connected";
    roomInfo.textContent = `Room: ${state.roomId} | You are ${state.myPlayer === "P1" ? "Player 1" : "Player 2"}`;
  } else {
    shareBox.hidden = true;
    connectionStatus.textContent = "Firebase ready";
    roomInfo.textContent = "No room joined yet";
  }
}

function canCurrentUserPlay() {
  if (state.mode === "ai" && state.currentPlayer === "P2") return false;
  if (state.mode === "online" && state.myPlayer !== state.currentPlayer) return false;
  return true;
}

function startNewGame(size = state.boardSize, mode = state.mode) {
  state.boardSize = size;
  state.board = createBoard(size);
  state.mode = mode;
  state.currentPlayer = "P1";
  state.scores = { P1: 0, P2: 0 };
  state.winningCells = new Set();

  showMessage("New game started. Player 1 begins.");
  render();
}

function applyMove(board, scores, row, col, letter, player) {
  if (!inBounds(row, col, board.length)) return null;
  if (board[row][col]) return null;

  const nextBoard = cloneBoard(board);
  nextBoard[row][col] = letter;

  const result = countSOSFromMove(nextBoard, row, col);
  const nextScores = { ...scores };

  if (result.count > 0) {
    nextScores[player] += result.count;
  }

  return {
    nextBoard,
    nextScores,
    madeSOS: result.count > 0,
    scoreCount: result.count
  };
}

async function handleCellClick(row, col) {
  if (!canCurrentUserPlay()) {
    showMessage("It is not your turn.");
    return;
  }

  const result = applyMove(state.board, state.scores, row, col, state.selectedLetter, state.currentPlayer);
  if (!result) return;

  let nextPlayer = state.currentPlayer;
  let message = "";

  if (result.madeSOS) {
    message = `${getPlayerLabel(state.currentPlayer)} made ${result.scoreCount} SOS and gets another turn.`;
  } else {
    nextPlayer = state.currentPlayer === "P1" ? "P2" : "P1";
    message = `${nextPlayer === "P1" ? "Player 1" : state.mode === "ai" ? "AI" : "Player 2"}'s turn.`;
  }

  state.board = result.nextBoard;
  state.scores = result.nextScores;
  state.currentPlayer = nextPlayer;
  rebuildWinningCells();

  if (boardIsFull(state.board)) {
    message = "Game over. The board is full.";
  }

  showMessage(message);
  render();

  if (state.mode === "online") {
    await saveOnlineState(message);
  }

  if (state.mode === "ai" && state.currentPlayer === "P2" && !boardIsFull(state.board)) {
    window.setTimeout(makeAIMove, 350);
  }
}

function findBestAIMove(board) {
  const emptyCells = [];
  let bestScoringMove = null;

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col]) continue;
      emptyCells.push([row, col]);

      for (const letter of ["S", "O"]) {
        const testBoard = cloneBoard(board);
        testBoard[row][col] = letter;
        const score = countSOSFromMove(testBoard, row, col).count;

        if (score > 0 && (!bestScoringMove || score > bestScoringMove.score)) {
          bestScoringMove = { row, col, letter, score };
        }
      }
    }
  }

  if (bestScoringMove) return bestScoringMove;

  for (const [row, col] of emptyCells) {
    for (const letter of ["S", "O"]) {
      const testBoard = cloneBoard(board);
      testBoard[row][col] = letter;
      const score = countSOSFromMove(testBoard, row, col).count;
      if (score > 0) return { row, col, letter, score: 0 };
    }
  }

  if (emptyCells.length === 0) return null;
  const [row, col] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  return { row, col, letter: Math.random() > 0.5 ? "S" : "O", score: 0 };
}

function makeAIMove() {
  const aiMove = findBestAIMove(state.board);
  if (!aiMove) return;

  const result = applyMove(state.board, state.scores, aiMove.row, aiMove.col, aiMove.letter, "P2");
  if (!result) return;

  state.board = result.nextBoard;
  state.scores = result.nextScores;

  if (result.madeSOS) {
    state.currentPlayer = "P2";
    showMessage(`AI placed ${aiMove.letter}, made ${result.scoreCount} SOS, and gets another turn.`);
  } else {
    state.currentPlayer = "P1";
    showMessage(`AI placed ${aiMove.letter}. Player 1's turn.`);
  }

  if (boardIsFull(state.board)) {
    state.currentPlayer = "P1";
    showMessage("Game over. The board is full.");
  }

  rebuildWinningCells();
  render();

  if (state.currentPlayer === "P2" && !boardIsFull(state.board)) {
    window.setTimeout(makeAIMove, 350);
  }
}

function createRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

async function createOnlineRoom() {
  const size = getSafeBoardSize();
  const roomId = createRoomId();

  if (state.unsubscribeRoom) state.unsubscribeRoom();

  state.roomId = roomId;
  state.myPlayer = "P1";
  state.mode = "online";
  startNewGame(size, "online");

  const roomRef = doc(db, "games", roomId);
  await setDoc(roomRef, {
    boardSize: state.boardSize,
    board: state.board,
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    message: "Online room created. Send the link to Player 2.",
    player1Joined: true,
    player2Joined: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  window.history.replaceState({}, "", `?room=${roomId}`);

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(link).catch(() => undefined);
  }

  showMessage("Online room created. Link copied if your browser allowed it. Send it to Player 2.");
  listenToRoom(roomId);
  render();
}

async function joinOnlineRoom(roomId) {
  const roomRef = doc(db, "games", roomId);
  const snapshot = await getDoc(roomRef);

  if (!snapshot.exists()) {
    showMessage("This room does not exist. Ask Player 1 to create a new link.");
    return;
  }

  const data = snapshot.data();

  if (state.unsubscribeRoom) state.unsubscribeRoom();

  state.roomId = roomId;
  state.myPlayer = data.player2Joined ? "P1" : "P2";
  state.mode = "online";

  if (!data.player2Joined) {
    await updateDoc(roomRef, {
      player2Joined: true,
      updatedAt: serverTimestamp()
    });
  }

  applyRemoteData(data);
  showMessage(state.myPlayer === "P2" ? "You joined as Player 2. Wait for your turn." : "You rejoined as Player 1.");
  listenToRoom(roomId);
  render();
}

function applyRemoteData(data) {
  state.applyingRemoteUpdate = true;
  state.boardSize = data.boardSize;
  state.board = data.board;
  state.currentPlayer = data.currentPlayer;
  state.scores = data.scores || { P1: 0, P2: 0 };
  rebuildWinningCells();

  if (data.message) {
    showMessage(data.message);
  }

  state.applyingRemoteUpdate = false;
}

function listenToRoom(roomId) {
  const roomRef = doc(db, "games", roomId);

  state.unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
    if (!snapshot.exists()) return;

    const data = snapshot.data();
    applyRemoteData(data);
    render();
  });
}

async function saveOnlineState(message) {
  if (!state.roomId) return;

  const roomRef = doc(db, "games", state.roomId);
  await updateDoc(roomRef, {
    boardSize: state.boardSize,
    board: state.board,
    currentPlayer: state.currentPlayer,
    scores: state.scores,
    message,
    updatedAt: serverTimestamp()
  });
}

function getSafeBoardSize() {
  const parsed = Number(boardSizeInput.value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(Math.max(Math.floor(parsed), 3), 30);
}

function leaveOnlineRoomIfNeeded() {
  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }

  state.roomId = null;
  state.myPlayer = null;

  if (window.location.search.includes("room=")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

chooseS.addEventListener("click", () => {
  state.selectedLetter = "S";
  render();
});

chooseO.addEventListener("click", () => {
  state.selectedLetter = "O";
  render();
});

modeSelect.addEventListener("change", () => {
  const nextMode = modeSelect.value;
  leaveOnlineRoomIfNeeded();
  state.mode = nextMode;
  startNewGame(getSafeBoardSize(), nextMode);
});

newGameButton.addEventListener("click", async () => {
  const size = getSafeBoardSize();

  if (state.mode === "online" && state.roomId && state.myPlayer === "P1") {
    startNewGame(size, "online");
    await saveOnlineState("Player 1 started a new online game.");
    return;
  }

  if (state.mode === "online" && state.myPlayer !== "P1") {
    showMessage("Only Player 1 can restart an online room.");
    return;
  }

  startNewGame(size, state.mode);
});

createRoomButton.addEventListener("click", createOnlineRoom);

copyLinkButton.addEventListener("click", async () => {
  const link = state.roomId
    ? `${window.location.origin}${window.location.pathname}?room=${state.roomId}`
    : window.location.href;

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(link).catch(() => undefined);
    showMessage("Link copied.");
  } else {
    showMessage("Copy the link from your browser address bar.");
  }
});

window.addEventListener("load", async () => {
  state.board = createBoard(state.boardSize);

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room");

  if (roomId) {
    await joinOnlineRoom(roomId);
  } else {
    startNewGame(12, "ai");
  }
});
