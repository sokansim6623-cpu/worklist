import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  query, onSnapshot, serverTimestamp, where, getDocs, limit, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD21eQ4LDWVzT5mdn9DBXgJj2cWrFBj6uc",
  authDomain: "sokansimworklist.firebaseapp.com",
  projectId: "sokansimworklist",
  storageBucket: "sokansimworklist.firebasestorage.app",
  messagingSenderId: "528257328628",
  appId: "1:528257328628:web:27fa057d01964ff08685a1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const COL = "worklist";
const $ = (id) => document.getElementById(id);

function pad2(n){ return String(n).padStart(2, "0"); }
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function fmtTime(ts){
  if(!ts) return "";
  try{
    const d = ts.toDate();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }catch{
    return "";
  }
}
function getSelectedExams(){
  return Array.from(document.querySelectorAll(".examChk:checked")).map(x => x.value);
}

let all = [];

async function addItem(){
  const name = ($("name")?.value || "").trim();
  const chart = ($("chart")?.value || "").trim();
  const examDate = $("examDate")?.value;
  const exams = getSelectedExams();

  if(!name || !chart || !examDate || exams.length === 0){
    alert("검사날짜/이름/차트번호/검사항목을 확인해 주세요.");
    return;
  }

  // 중복 체크(같은 날짜 + 차트 + 검사)
  for(const exam of exams){
    const dupQ = query(
      collection(db, COL),
      where("examDate", "==", examDate),
      where("chart", "==", chart),
      where("exam", "==", exam),
      limit(1)
    );
    const snap = await getDocs(dupQ);
    if(!snap.empty){
      const ok = confirm("선택한 항목 중 이미 등록된 검사가 포함되어 있습니다.\n그래도 등록할까요?");
      if(!ok) return;
      break;
    }
  }

  // 여러 검사 한번에 등록
  for(const exam of exams){
    await addDoc(collection(db, COL), {
      name,
      chart,
      exam,
      examDate,
      status: "대기",
      visitAt: null,
      startAt: null,
      finishAt: null,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    });
  }

  $("name").value = "";
  $("chart").value = "";
  document.querySelectorAll(".examChk").forEach(x => x.checked = false);
}

function render(){
  const qText = (($("q")?.value || "").trim()).toLowerCase();
  const selectedDate = $("examDate")?.value || todayStr();
  const list = $("list");
  list.innerHTML = "";

  // all은 이미 createdAtMs desc 로 들어옴 (Firestore에서 정렬)
  const filtered = all
    .filter(it => it.examDate === selectedDate)
    .filter(it => {
      if(!qText) return true;
      const hay = `${it.name} ${it.chart} ${it.exam}`.toLowerCase();
      return hay.includes(qText);
    });

  if(filtered.length === 0){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="muted">표시할 항목이 없습니다.</td>`;
    list.appendChild(tr);
    return;
  }

  for(const it of filtered){
    const visitText  = fmtTime(it.visitAt)  || "접수";
    const startText  = fmtTime(it.startAt)  || "Start";
    const finishText = fmtTime(it.finishAt) || "Finish";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.examDate}</td>
      <td>${it.name}</td>
      <td>${it.chart}</td>
      <td>${it.exam}</td>
      <td style="color:${it.status === "진행중" ? "red" :it.status === "완료" ? "blue" :"black"};">${it.status}</td>


      <td><button data-act="visit" data-id="${it.id}">${visitText}</button></td>
      <td><button data-act="start" data-id="${it.id}">${startText}</button></td>
      <td><button data-act="finish" data-id="${it.id}">${finishText}</button></td>

      <td><button data-act="del" data-id="${it.id}">삭제</button></td>
    `;
    list.appendChild(tr);
  }
}

async function markVisit(id){
  await updateDoc(doc(db, COL, id), { status: "접수", visitAt: serverTimestamp() });
}
async function startExam(id){
  await updateDoc(doc(db, COL, id), { status: "진행중", startAt: serverTimestamp() });
}
async function finishExam(id){
  await updateDoc(doc(db, COL, id), { status: "완료", finishAt: serverTimestamp() });
}
async function removeItem(id){
  if(!confirm("삭제할까요?")) return;
  await deleteDoc(doc(db, COL, id));
}

function wireEvents(){
  $("btnAdd").addEventListener("click", addItem);
  $("btnSearch").addEventListener("click", render);
  $("btnReset").addEventListener("click", () => { $("q").value = ""; render(); });
  $("examDate").addEventListener("change", render);

  $("list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if(!btn) return;

    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if(!act || !id) return;

    const it = all.find(x => x.id === id);
    if(!it) return;

    // disabled 안 쓰고, 상태로만 동작 제한(버튼 회색 방지)
    if(act === "visit"){
      if(it.status !== "대기") return;
      await markVisit(id);
      return;
    }
    if(act === "start"){
      if(it.status !== "접수") return;
      await startExam(id);
      return;
    }
    if(act === "finish"){
      if(it.status !== "진행중") return;
      await finishExam(id);
      return;
    }
    if(act === "del"){
      await removeItem(id);
      return;
    }
  });
}

// 시작
$("examDate").value = todayStr();
wireEvents();

onAuthStateChanged(auth, (user) => {
  if(!user){
    $("btnAdd").disabled = true;
    return;
  }
  $("btnAdd").disabled = false;

  // Firestore에서 최신 등록(createdAtMs desc)으로 받아오기
  const q = query(collection(db, COL), orderBy("createdAtMs", "desc"));

  onSnapshot(q, (snap) => {
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
});

signInAnonymously(auth);
