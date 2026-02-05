import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  query, onSnapshot, serverTimestamp, where, getDocs, limit, orderBy,
  writeBatch
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
const KEEP_DAYS = 90;
const KEEP_MS = KEEP_DAYS * 24 * 60 * 60 * 1000;

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

function escAttr(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

let all = [];
let ready = false;

const draftResult = new Map();
const draftFollow = new Map();

async function cleanupOldDocs(){
  const cutoff = Date.now() - KEEP_MS;
  const oldQ = query(collection(db, COL), where("createdAtMs", "<", cutoff));
  const snap = await getDocs(oldQ);
  if(snap.empty) return;

  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

async function addItem(){
  if(!ready){
    alert("서버 연결 중입니다. 잠시 후 다시 시도해 주세요.");
    return;
  }

  const name = ($("name")?.value || "").trim();
  const chart = ($("chart")?.value || "").trim();
  const examDate = $("examDate")?.value;
  const exams = getSelectedExams();

  if(!name || !chart || !examDate || exams.length === 0){
    alert("검사날짜/이름/차트번호/검사항목을 확인해 주세요.");
    return;
  }

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
      result: "",
      followUp: "",
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

  const filtered = all
    .filter(it => it.examDate === selectedDate)
    .filter(it => {
      if(!qText) return true;
      const hay = `${it.name} ${it.chart} ${it.exam}`.toLowerCase();
      return hay.includes(qText);
    });

  if(filtered.length === 0){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="11" class="muted">표시할 항목이 없습니다.</td>`;
    list.appendChild(tr);
    return;
  }

  for(const it of filtered){
    const visitText  = fmtTime(it.visitAt)  || "접수";
    const startText  = fmtTime(it.startAt)  || "Start";
    const finishText = fmtTime(it.finishAt) || "Finish";

    const resultVal = draftResult.has(it.id) ? draftResult.get(it.id) : (it.result || "");
    const followVal = draftFollow.has(it.id) ? draftFollow.get(it.id) : (it.followUp || "");

    const safeResult = escAttr(resultVal);
    const safeFollow = escAttr(followVal);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.examDate || ""}</td>
      <td>${it.name || ""}</td>
      <td>${it.chart || ""}</td>
      <td>${it.exam || ""}</td>
      <td style="color:${it.status === "진행중" ? "red" : it.status === "완료" ? "blue" : "black"};">${it.status || ""}</td>

      <td><button data-act="visit" data-id="${it.id}">${visitText}</button></td>
      <td><button data-act="start" data-id="${it.id}">${startText}</button></td>
      <td><button data-act="finish" data-id="${it.id}">${finishText}</button></td>

      <td>
        <input class="resultInput" data-role="result" data-id="${it.id}"
          value="${safeResult}" placeholder="결과 입력">
      </td>

      <td>
        <input class="resultInput" data-role="followUp" data-id="${it.id}"
          value="${safeFollow}" placeholder="">
      </td>

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

async function resetVisit(id){
  await updateDoc(doc(db, COL, id), { status: "대기", visitAt: null, startAt: null, finishAt: null });
}
async function resetStart(id){
  await updateDoc(doc(db, COL, id), { status: "접수", startAt: null, finishAt: null });
}
async function resetFinish(id){
  await updateDoc(doc(db, COL, id), { status: "진행중", finishAt: null });
}

function exportToXlsx(){
  if(typeof XLSX === "undefined"){
    alert("엑셀 저장 기능 로딩에 실패했습니다. (xlsx 라이브러리 확인 필요)");
    return;
  }

  const selectedDate = $("examDate")?.value || todayStr();
  const qText = (($("q")?.value || "").trim()).toLowerCase();

  const rows = all
    .filter(it => it.examDate === selectedDate)
    .filter(it => {
      if(!qText) return true;
      const hay = `${it.name} ${it.chart} ${it.exam}`.toLowerCase();
      return hay.includes(qText);
    })
    .map(it => ({
      "검사날짜": it.examDate || "",
      "이름": it.name || "",
      "차트번호": it.chart || "",
      "검사항목": it.exam || "",
      "상태": it.status || "",
      "접수": fmtTime(it.visitAt) || "",
      "Start": fmtTime(it.startAt) || "",
      "Finish": fmtTime(it.finishAt) || "",
      "검사결과": (draftResult.has(it.id) ? draftResult.get(it.id) : (it.result || "")) || "",
      "추적검사시기": (draftFollow.has(it.id) ? draftFollow.get(it.id) : (it.followUp || "")) || ""
    }));

  if(rows.length === 0){
    alert("엑셀로 저장할 항목이 없습니다.");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Worklist");
  XLSX.writeFile(wb, `worklist_${selectedDate}.xlsx`);
}

function wireEvents(){
  $("btnAdd")?.addEventListener("click", addItem);
  $("btnSearch")?.addEventListener("click", render);
  $("btnReset")?.addEventListener("click", () => { $("q").value = ""; render(); });
  $("examDate")?.addEventListener("change", render);
  $("btnExportXlsx")?.addEventListener("click", exportToXlsx);

  $("list")?.addEventListener("input", (e) => {
    const resultInput = e.target.closest('input[data-role="result"]');
    if(resultInput){
      draftResult.set(resultInput.dataset.id, resultInput.value);
      return;
    }
    const followInput = e.target.closest('input[data-role="followUp"]');
    if(followInput){
      draftFollow.set(followInput.dataset.id, followInput.value);
      return;
    }
  });

  $("list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if(!btn) return;

    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if(!act || !id) return;

    const it = all.find(x => x.id === id);
    if(!it) return;

    if(act === "visit"){
      if(it.status === "대기"){ await markVisit(id); return; }
      if(it.status === "접수"){ await resetVisit(id); return; }
      return;
    }
    if(act === "start"){
      if(it.status === "접수"){ await startExam(id); return; }
      if(it.status === "진행중" || it.status === "완료"){ await resetStart(id); return; }
      return;
    }
    if(act === "finish"){
      if(it.status === "진행중"){ await finishExam(id); return; }
      if(it.status === "완료"){ await resetFinish(id); return; }
      return;
    }
    if(act === "del"){
      await removeItem(id);
      draftResult.delete(id);
      draftFollow.delete(id);
      return;
    }
  });

  $("list")?.addEventListener("keydown", (e) => {
    const input = e.target.closest('input[data-role="result"], input[data-role="followUp"]');
    if(!input) return;
    if(e.key !== "Enter") return;
    e.preventDefault();
    input.blur();
  });

  $("list")?.addEventListener("focusout", async (e) => {
    const resultInput = e.target.closest('input[data-role="result"]');
    if(resultInput){
      const id = resultInput.dataset.id;
      const val = (resultInput.value ?? "").trim();
      try{
        await updateDoc(doc(db, COL, id), { result: val });
        draftResult.delete(id);
      }catch(err){
        console.error(err);
        alert("검사결과 저장에 실패했습니다.");
      }
      return;
    }

    const followInput = e.target.closest('input[data-role="followUp"]');
    if(followInput){
      const id = followInput.dataset.id;
      const val = (followInput.value ?? "").trim();
      try{
        await updateDoc(doc(db, COL, id), { followUp: val });
        draftFollow.delete(id);
      }catch(err){
        console.error(err);
        alert("추적검사시기 저장에 실패했습니다.");
      }
      return;
    }
  });
}

$("examDate").value = todayStr();
wireEvents();

onAuthStateChanged(auth, async (user) => {
  if(!user) return;
  ready = true;

  try{ await cleanupOldDocs(); }catch(err){ console.error("cleanup failed:", err); }

  const q = query(collection(db, COL), orderBy("createdAtMs", "desc"));
  onSnapshot(q, (snap) => {
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
});

signInAnonymously(auth);
