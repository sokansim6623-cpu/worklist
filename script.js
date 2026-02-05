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
const KEEP_DAYS = 90; // 최근 3개월(90일)
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

let all = [];
let ready = false;

// 저장 상태/임시 입력값 유지
const saveState = new Map();   // id -> { state: "idle"|"saving"|"saved"|"failed" }
const draftResult = new Map(); // id -> string

async function cleanupOldDocs(){
  const cutoff = Date.now() - KEEP_MS;

  const oldQ = query(
    collection(db, COL),
    where("createdAtMs", "<", cutoff)
  );

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
      result: "",
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
    tr.innerHTML = `<td colspan="10" class="muted">표시할 항목이 없습니다.</td>`;
    list.appendChild(tr);
    return;
  }

  for(const it of filtered){
    const visitText  = fmtTime(it.visitAt)  || "접수";
    const startText  = fmtTime(it.startAt)  || "Start";
    const finishText = fmtTime(it.finishAt) || "Finish";

    const st = saveState.get(it.id)?.state || "idle";
    const btnText =
      st === "saving" ? "저장중" :
      st === "saved"  ? "저장됨" :
      st === "failed" ? "실패(다시)" : "저장";

    const currentVal = draftResult.has(it.id) ? draftResult.get(it.id) : (it.result || "");
    const safeVal = String(currentVal).replaceAll('"', "&quot;");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.examDate}</td>
      <td>${it.name}</td>
      <td>${it.chart}</td>
      <td>${it.exam}</td>
      <td style="color:${it.status === "진행중" ? "red" : it.status === "완료" ? "blue" : "black"};">${it.status}</td>
      <td><button data-act="visit" data-id="${it.id}">${visitText}</button></td>
      <td><button data-act="start" data-id="${it.id}">${startText}</button></td>
      <td><button data-act="finish" data-id="${it.id}">${finishText}</button></td>

      <td>
        <div class="resultBox">
          <input class="resultInput" data-role="result" data-id="${it.id}" value="${safeVal}" placeholder="결과 입력">
          <button class="resultBtn" data-act="saveResult" data-id="${it.id}" ${st==="saving" ? "disabled" : ""}>${btnText}</button>
        </div>
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
async function saveResultToDb(id, result){
  await updateDoc(doc(db, COL, id), { result });
}
async function removeItem(id){
  if(!confirm("삭제할까요?")) return;
  await deleteDoc(doc(db, COL, id));
}

/* ✅ 토글 리셋 */
async function resetVisit(id){
  await updateDoc(doc(db, COL, id), {
    status: "대기",
    visitAt: null,
    startAt: null,
    finishAt: null
  });
}
async function resetStart(id){
  await updateDoc(doc(db, COL, id), {
    status: "접수",
    startAt: null,
    finishAt: null
  });
}
async function resetFinish(id){
  await updateDoc(doc(db, COL, id), {
    status: "진행중",
    finishAt: null
  });
}

/* ✅ 엑셀 저장: 현재 선택 날짜 + 검색어 필터 그대로 적용 */
function exportToXlsx(){
  // xlsx 라이브러리 존재 확인
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
      "검사결과": (draftResult.has(it.id) ? draftResult.get(it.id) : (it.result || "")) || ""
    }));

  if(rows.length === 0){
    alert("엑셀로 저장할 항목이 없습니다.");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Worklist");

  const filename = `worklist_${selectedDate}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function wireEvents(){
  $("btnAdd").addEventListener("click", addItem);
  $("btnSearch").addEventListener("click", render);
  $("btnReset").addEventListener("click", () => { $("q").value = ""; render(); });
  $("examDate").addEventListener("change", render);

  // ✅ 엑셀 저장 버튼
  $("btnExportXlsx")?.addEventListener("click", exportToXlsx);

  // 입력 중 캐시 유지
  $("list").addEventListener("input", (e) => {
    const input = e.target.closest('input[data-role="result"]');
    if(!input) return;
    const id = input.dataset.id;
    draftResult.set(id, input.value);
    saveState.set(id, { state: "idle" });
  });

  $("list").addEventListener("click", async (e) => {
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

    if(act === "saveResult"){
      const input = document.querySelector(`input[data-role="result"][data-id="${id}"]`);
      const val = (input?.value ?? "").trim();

      saveState.set(id, { state: "saving" });
      render();

      try{
        await saveResultToDb(id, val);

        draftResult.delete(id);
        saveState.set(id, { state: "saved" });
        render();

        setTimeout(() => {
          if(draftResult.has(id)) return;
          saveState.set(id, { state: "idle" });
          render();
        }, 900);

      }catch(err){
        console.error(err);
        saveState.set(id, { state: "failed" });
        render();
      }
      return;
    }

    if(act === "del"){
      await removeItem(id);
      draftResult.delete(id);
      saveState.delete(id);
      return;
    }
  });

  // Enter로 저장
  $("list").addEventListener("keydown", (e) => {
    const input = e.target.closest('input[data-role="result"]');
    if(!input) return;
    if(e.key !== "Enter") return;
    e.preventDefault();
    const id = input.dataset.id;
    const btn = document.querySelector(`button[data-act="saveResult"][data-id="${id}"]`);
    if(btn) btn.click();
  });
}

// 시작
$("examDate").value = todayStr();
wireEvents();

onAuthStateChanged(auth, async (user) => {
  if(!user) return;

  ready = true;

  // 최근 3개월 초과 데이터 삭제(접속 시 1회)
  try{
    await cleanupOldDocs();
  }catch(err){
    console.error("cleanup failed:", err);
  }

  // 최신 등록 순으로 로드
  const q = query(collection(db, COL), orderBy("createdAtMs", "desc"));
  onSnapshot(q, (snap) => {
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
});

signInAnonymously(auth);
