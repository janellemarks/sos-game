const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

let boardSize = 12;
let board = [];
let selectedLetter = "S";
let mode = "ai";
let currentPlayer = "P1";
let scores = { P1: 0, P2: 0 };
let winningCells = new Set();

const boardEl = document.getElementById("board");
const boardSizeInput = document.getElementById("boardSize");
const gameMode = document.getElementById("gameMode");
const newGameBtn = document.getElementById("newGameBtn");
const chooseS = document.getElementById("chooseS");
const chooseO = document.getElementById("chooseO");
const currentTurn = document.getElementById("currentTurn");
const scoreP1 = document.getElementById("scoreP1");
const scoreP2 = document.getElementById("scoreP2");
const player2Label = document.getElementById("player2Label");
const leaderText = document.getElementById("leaderText");
const message = document.getElementById("message");
const boardTitle = document.getElementById("boardTitle");
const shareBtn = document.getElementById("shareBtn");
const shareLink = document.getElementById("shareLink");

function createBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => ""));
}

function cloneBoard(sourceBoard) {
  return sourceBoard.map((row) => [...row]);
}

function inBounds(row, col, size) {
  return row >= 0 && row < size && col >= 0 && col < size;
}

function countSOSFromMove(sourceBoard, row, col) {
  const size = sourceBoard.length;
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

        word += sourceBoard[r][c];
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

function boardIsFull(sourceBoard) {
  return sourceBoard.every((row) => row.every((cell) => cell !== ""));
}

function getPlayerLabel(player) {
  if (player === "P1") return "Player 1";
  return mode === "ai" ? "AI" : "Player 2";
}

function findBestAIMove(sourceBoard) {
  const size = sourceBoard.length;
  const emptyCells = [];
  let bestScoringMove = null;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (sourceBoard[row][col]) continue;
      emptyCells.push([row, col]);

      for (const letter of ["S", "O"]) {
        const testBoard = cloneBoard(sourceBoard);
        testBoard[row][col] = letter;
        const score = countSOSFromMove(testBoard, row, col).count;

        if (score > 0 && (!bestScoringMove || score > bestScoringMove.score)) {
          bestScoringMove = { row, col, letter, score };
        }
      }
    }
  }

  if (bestScoringMove) return bestScoringMove;

  // Block a possible human score.
  for (const [row, col] of emptyCells) {
    for (const letter of ["S", "O"]) {
      const testBoard = cloneBoard(sourceBoard);
      testBoard[row][col] = letter;
      const humanWouldScore = countSOSFromMove(testBoard, row, col).count;

      if (humanWouldScore > 0) {
        return { row, col, letter, score: 0 };
      }
    }
  }

  if (emptyCells.length === 0) return null;

  const [row, col] = emptyCells[Math.floor(Math.random() * emptyCells.length)];
  return {
    row,
    col,
    letter: Math.random() > 0.5 ? "S" : "O",
    score: 0,
  };
}

function updateScreen() {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${boardSize}, minmax(28px, 1fr))`;

  for (let row = 0; row < boardSize; row += 1) {
    for (let col = 0; col < boardSize; col += 1) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.textContent = board[row][col];
      cell.disabled = Boolean(board[row][col]) || (mode === "ai" && currentPlayer === "P2");

      if (winningCells.has(`${row}-${col}`)) {
        cell.classList.add("winning");
      }

      cell.addEventListener("click", () => handleCellClick(row, col));
      boardEl.appendChild(cell);
    }
  }

  currentTurn.textContent = getPlayerLabel(currentPlayer);
  scoreP1.textContent = scores.P1;
  scoreP2.textContent = scores.P2;
  player2Label.textContent = mode === "ai" ? "AI" : "Player 2";
  boardTitle.textContent = `Board: ${boardSize} × ${boardSize}`;

  if (scores.P1 === scores.P2) {
    leaderText.textContent = "Draw so far";
  } else if (scores.P1 > scores.P2) {
    leaderText.textContent = "Player 1 leads";
  } else {
    leaderText.textContent = mode === "ai" ? "AI leads" : "Player 2 leads";
  }
}

function resetGame() {
  const requestedSize = Number(boardSizeInput.value);
  boardSize = Number.isFinite(requestedSize)
    ? Math.min(Math.max(Math.floor(requestedSize), 3), 60)
    : 12;

  boardSizeInput.value = boardSize;
  mode = gameMode.value;
  board = createBoard(boardSize);
  selectedLetter = "S";
  currentPlayer = "P1";
  scores = { P1: 0, P2: 0 };
  winningCells = new Set();
  shareLink.textContent = "";
  message.textContent = "New game started. Player 1 starts.";

  chooseS.classList.add("active");
  chooseO.classList.remove("active");

  updateScreen();
}

function handleCellClick(row, col) {
  if (board[row][col]) return;
  if (mode === "ai" && currentPlayer === "P2") return;

  applyMove(row, col, selectedLetter, currentPlayer);
}

function applyMove(row, col, letter, player) {
  board[row][col] = letter;

  const result = countSOSFromMove(board, row, col);

  if (result.count > 0) {
    scores[player] += result.count;

    for (const line of result.lines) {
      for (const [r, c] of line) {
        winningCells.add(`${r}-${c}`);
      }
    }

    message.textContent = `${getPlayerLabel(player)} made ${result.count} SOS and gets another turn.`;
  } else {
    currentPlayer = currentPlayer === "P1" ? "P2" : "P1";
    message.textContent = `${getPlayerLabel(currentPlayer)}'s turn.`;
  }

  if (boardIsFull(board)) {
    message.textContent = "Game over. The board is full.";
  }

  updateScreen();

  if (mode === "ai" && currentPlayer === "P2" && !boardIsFull(board)) {
    window.setTimeout(makeAIMove, 300);
  }
}

function makeAIMove() {
  const aiMove = findBestAIMove(board);
  if (!aiMove) return;

  board[aiMove.row][aiMove.col] = aiMove.letter;

  const result = countSOSFromMove(board, aiMove.row, aiMove.col);

  if (result.count > 0) {
    scores.P2 += result.count;

    for (const line of result.lines) {
      for (const [r, c] of line) {
        winningCells.add(`${r}-${c}`);
      }
    }

    message.textContent = `AI placed ${aiMove.letter}, made ${result.count} SOS, and gets another turn.`;
  } else {
    currentPlayer = "P1";
    message.textContent = `AI placed ${aiMove.letter}. Player 1's turn.`;
  }

  if (boardIsFull(board)) {
    message.textContent = "Game over. The board is full.";
    currentPlayer = "P1";
  }

  updateScreen();

  if (mode === "ai" && currentPlayer === "P2" && !boardIsFull(board)) {
    window.setTimeout(makeAIMove, 300);
  }
}

chooseS.addEventListener("click", () => {
  selectedLetter = "S";
  chooseS.classList.add("active");
  chooseO.classList.remove("active");
});

chooseO.addEventListener("click", () => {
  selectedLetter = "O";
  chooseO.classList.add("active");
  chooseS.classList.remove("active");
});

newGameBtn.addEventListener("click", resetGame);

gameMode.addEventListener("change", resetGame);

shareBtn.addEventListener("click", () => {
  const fakeGameId = Math.random().toString(36).slice(2, 9);
  const link = `${window.location.origin}${window.location.pathname}?game=${fakeGameId}`;
  shareLink.textContent = link;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).catch(() => {});
  }

  message.textContent =
    "Demo link created. This does not yet allow two devices to play together. That needs Firebase or Supabase later.";
});

resetGame();
