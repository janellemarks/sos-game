import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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

const els = {
  firebaseStatus: document.getElementById("firebaseStatus"),
  modeSelect: document.getElementById("modeSelect"),
  boardSizeInput: document.getElementById("boardSizeInput"),
  selectS: document.getElementById("selectS"),
  selectO: document.getElementById("selectO"),
  newGameBtn: document.getElementById("newGameBtn"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  message: document.getElementById("message"),
  scoreP1: document.getElementById("scoreP1"),
  scoreP2: document.getElementById("scoreP2"),
  p2Label: document.getElementById("p2Label"),
  turnLabel: document.getElementById("turnLabel"),
  roomBox: document.getElementById("roomBox"),
  roomLink: document.getElementById("roomLink"),
  boardTitle: document.getElementById("boardTitle"),
  board: document.getElementById("board")
};

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  els.firebaseStatus.textContent = "Firebase ready";
} catch (error) {
  console.error(error);
  els.firebaseStatus.textContent = "Firebase failed";
}

const DIRECTIONS = [[0,1],[1,0],[1,1],[1,-1]];
const state = {
  size: 12, board: [], selectedLetter: "S", mode: "ai", currentPlayer: "P1",
  scores: { P1: 0, P2: 0 }, winningCells: new Set(), roomId: null, myPlayer: "P1"
};

function createBoard(size){ return Array.from({length:size},()=>Array.from({length:size},()=> "")); }
function cloneBoard(board){ return board.map(row => row.slice()); }
function boardIsFull(board){ return board.every(row => row.every(cell => cell !== "")); }
function inBounds(r,c,size){ return r>=0 && r<size && c>=0 && c<size; }
function playerLabel(player){ if(player==="P1") return "Player 1"; return state.mode==="ai" ? "AI" : "Player 2"; }
function setMessage(text){ els.message.textContent = text; }
function safeSize(){ const n=Number(els.boardSizeInput.value); return Number.isFinite(n) ? Math.max(3, Math.min(40, Math.floor(n))) : 12; }
function flattenBoard(board){ return board.flat(); }
function unflattenBoard(flat,size){ const b=[]; for(let r=0;r<size;r++) b.push((flat||[]).slice(r*size,(r+1)*size)); return b; }
function winningSetToArray(){ return [...state.winningCells].map(k => k.split("-").map(Number)); }
function arrayToWinningSet(arr){ const s=new Set(); for(const pair of (arr||[])) s.add(`${pair[0]}-${pair[1]}`); return s; }
function makeRoomId(){ return Math.random().toString(36).slice(2,8); }
function roomUrl(){ return `${window.location.origin}${window.location.pathname}?room=${state.roomId}`; }

function countSOSFromMove(board,row,col){
  const size=board.length; let count=0; const lines=[];
  for(const [dr,dc] of DIRECTIONS){
    for(let offset=-2; offset<=0; offset++){
      let word=""; const cells=[];
      for(let i=0;i<3;i++){
        const r=row+(offset+i)*dr, c=col+(offset+i)*dc;
        if(!inBounds(r,c,size)){ word=""; break; }
        word += board[r][c]; cells.push([r,c]);
      }
      if(word==="SOS"){ count++; lines.push(cells); }
    }
  }
  return {count, lines};
}

function resetLocalGame(){
  state.size = safeSize();
  state.board = createBoard(state.size);
  state.currentPlayer = "P1";
  state.scores = { P1:0, P2:0 };
  state.winningCells = new Set();
  setMessage("Choose S or O, then click a square.");
  render();
}

function canCurrentUserMove(){
  if(state.mode==="ai" && state.currentPlayer==="P2") return false;
  if(state.mode==="online" && state.currentPlayer !== state.myPlayer) return false;
  return true;
}

function render(){
  els.p2Label.textContent = state.mode==="ai" ? "AI" : "Player 2";
  els.scoreP1.textContent = state.scores.P1;
  els.scoreP2.textContent = state.scores.P2;
  els.turnLabel.textContent = playerLabel(state.currentPlayer);
  els.boardTitle.textContent = `Board: ${state.size} × ${state.size}`;
  els.selectS.classList.toggle("selected", state.selectedLetter==="S");
  els.selectO.classList.toggle("selected", state.selectedLetter==="O");
  els.roomBox.classList.toggle("hidden", !state.roomId);
  if(state.roomId) els.roomLink.textContent = roomUrl();

  const cellSize = state.size > 20 ? 32 : 42;
  els.board.style.gridTemplateColumns = `repeat(${state.size}, ${cellSize}px)`;
  els.board.innerHTML = "";
  for(let row=0; row<state.size; row++){
    for(let col=0; col<state.size; col++){
      const cell=document.createElement("button");
      cell.type="button";
      cell.className="cell";
      cell.style.width = `${cellSize}px`;
      cell.style.height = `${cellSize}px`;
      cell.textContent = state.board[row][col] || "";
      cell.disabled = Boolean(state.board[row][col]) || !canCurrentUserMove();
      if(state.winningCells.has(`${row}-${col}`)) cell.classList.add("win");
      cell.addEventListener("click", () => handleCellClick(row,col));
      els.board.appendChild(cell);
    }
  }
}

function applyMove(row,col,letter,player){
  if(!inBounds(row,col,state.size) || state.board[row][col]) return false;
  state.board[row][col]=letter;
  const result=countSOSFromMove(state.board,row,col);
  if(result.count>0){
    state.scores[player]+=result.count;
    for(const line of result.lines) for(const [r,c] of line) state.winningCells.add(`${r}-${c}`);
    setMessage(`${playerLabel(player)} made ${result.count} SOS and gets another turn.`);
  } else {
    state.currentPlayer = player==="P1" ? "P2" : "P1";
    setMessage(`${playerLabel(state.currentPlayer)}'s turn.`);
  }
  if(boardIsFull(state.board)) setMessage("Game over. The board is full.");
  return true;
}

async function handleCellClick(row,col){
  if(!canCurrentUserMove()){ setMessage(`Wait for ${playerLabel(state.currentPlayer)}.`); return; }
  const player=state.currentPlayer;
  if(!applyMove(row,col,state.selectedLetter,player)) return;
  render();
  if(state.mode==="online" && state.roomId){ await saveRoom(false); return; }
  if(state.mode==="ai" && state.currentPlayer==="P2" && !boardIsFull(state.board)) setTimeout(aiMove, 350);
}

function findBestAIMove(){
  let best=null; const empty=[];
  for(let row=0; row<state.size; row++) for(let col=0; col<state.size; col++){
    if(state.board[row][col]) continue; empty.push([row,col]);
    for(const letter of ["S","O"]){
      const test=cloneBoard(state.board); test[row][col]=letter;
      const score=countSOSFromMove(test,row,col).count;
      if(score>0 && (!best || score>best.score)) best={row,col,letter,score};
    }
  }
  if(best) return best;
  if(!empty.length) return null;
  const [row,col]=empty[Math.floor(Math.random()*empty.length)];
  return {row,col,letter:Math.random()>0.5?"S":"O",score:0};
}
function aiMove(){
  const move=findBestAIMove(); if(!move) return;
  applyMove(move.row,move.col,move.letter,"P2"); render();
  if(state.currentPlayer==="P2" && !boardIsFull(state.board)) setTimeout(aiMove,350);
}

async function saveRoom(isNew){
  if(!db || !state.roomId) return;
  const payload = {
    size: state.size, board: flattenBoard(state.board), currentPlayer: state.currentPlayer,
    scores: state.scores, winningCells: winningSetToArray(), updatedAt: serverTimestamp()
  };
  if(isNew){ payload.createdAt = serverTimestamp(); await setDoc(doc(db,"sosRooms",state.roomId), payload); }
  else await updateDoc(doc(db,"sosRooms",state.roomId), payload);
}

function subscribeToRoom(roomId){
  if(unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = onSnapshot(doc(db,"sosRooms",roomId), snap => {
    if(!snap.exists()) return;
    const data=snap.data();
    state.mode="online"; els.modeSelect.value="online";
    state.roomId=roomId; state.size=data.size || 12; els.boardSizeInput.value=state.size;
    state.board=unflattenBoard(data.board || [], state.size);
    state.currentPlayer=data.currentPlayer || "P1";
    state.scores=data.scores || {P1:0,P2:0};
    state.winningCells=arrayToWinningSet(data.winningCells || []);
    render();
  }, err => { console.error(err); setMessage("Firebase permission error. Check Firestore Rules are in test mode."); });
}

async function createOnlineRoom(){
  if(!db){ setMessage("Firebase is not ready. Refresh and try again."); return; }
  state.mode="online"; els.modeSelect.value="online"; state.roomId=makeRoomId(); state.myPlayer="P1";
  resetLocalGame(); state.mode="online";
  await saveRoom(true);
  window.history.replaceState({}, "", roomUrl());
  try{ await navigator.clipboard.writeText(roomUrl()); }catch(e){}
  setMessage("Online room created. Link copied. Send it to your friend.");
  subscribeToRoom(state.roomId); render();
}

async function joinOnlineRoom(roomId){
  if(!db){ setMessage("Firebase is not ready. Refresh and try again."); return; }
  state.mode="online"; els.modeSelect.value="online"; state.roomId=roomId;
  const ref=doc(db,"sosRooms",roomId); const snap=await getDoc(ref);
  if(snap.exists()){ state.myPlayer="P2"; setMessage("You joined as Player 2."); }
  else { state.myPlayer="P1"; resetLocalGame(); state.mode="online"; state.roomId=roomId; await saveRoom(true); setMessage("New online room created. Send this link to your friend."); }
  subscribeToRoom(roomId); render();
}

els.selectS.addEventListener("click",()=>{ state.selectedLetter="S"; render(); });
els.selectO.addEventListener("click",()=>{ state.selectedLetter="O"; render(); });
els.newGameBtn.addEventListener("click", async()=>{ resetLocalGame(); if(state.mode==="online" && state.roomId) await saveRoom(false); });
els.modeSelect.addEventListener("change",()=>{ state.mode=els.modeSelect.value; if(state.mode!=="online"){ state.roomId=null; if(unsubscribeRoom) unsubscribeRoom(); } resetLocalGame(); });
els.createRoomBtn.addEventListener("click", createOnlineRoom);
els.copyLinkBtn.addEventListener("click", async()=>{ const url=state.roomId ? roomUrl() : window.location.href; try{ await navigator.clipboard.writeText(url); }catch(e){} setMessage("Current link copied."); });

resetLocalGame();
const roomFromUrl = new URLSearchParams(window.location.search).get("room");
if(roomFromUrl) joinOnlineRoom(roomFromUrl);
