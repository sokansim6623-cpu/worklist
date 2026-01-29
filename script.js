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
let ready = false;

// 실패/로딩 상태를 행별로 기억 (렌더링돼도 상태 유지)
const saveState = new Map(); // id -> { state: "idle"|"saving"|"saved"|"failed", msg?: string }

// 스냅샷으로 덮어쓰기 전에, 사용자가 입력 중인 값을 날리지 않기 위한 임시 캐시
const draftResult = new Map(); // id -> string

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

    // 입력 중이면 draftResult 우선(스냅샷이 와도 사용자가 쓴 글 유지)
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

function wireEvents(){
  $("btnAdd").addEventListener("click", addItem);
  $("btnSearch").addEventListener("click", render);
  $("btnReset").addEventListener("click", () => { $("q").value = ""; render(); });
  $("examDate").addEventListener("change", render);

  // 입력 중 캐시(draft) 유지
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

    if(act === "saveResult"){
      const input = document.querySelector(`input[data-role="result"][data-id="${id}"]`);
      const val = (input?.value ?? "").trim();

      // UI 상태 먼저 변경(저장중)
      saveState.set(id, { state: "saving" });
      render();

      try{
        await saveResultToDb(id, val);

        // 성공: draft 비우고(saved 표시)
        draftResult.delete(id);
        saveState.set(id, { state: "saved" });
        render();

        // saved 표시 잠깐 후 저장으로 복귀(수정 가능 유지)
        setTimeout(() => {
          // 그 사이에 사용자가 또 입력했으면 idle로 두기
          if(draftResult.has(id)) return;
          saveState.set(id, { state: "idle" });
          render();
        }, 900);

      }catch(err){
        console.error(err);
        // 실패해도 draft는 유지(글 안 날아감)
        saveState.set(id, { state: "failed" });
        render();
      }
      return;
    }

    if(act === "del"){
      await removeItem(id);
      // 삭제한 id 관련 캐시 정리
      draftResult.delete(id);
      saveState.delete(id);
      return;
    }
  });

  // Enter로 저장도 지원(선택사항이지만 편해서 넣음)
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

$("examDate").value = todayStr();
wireEvents();

onAuthStateChanged(auth, (user) => {
  if(!user) return;

  ready = true;

  const q = query(collection(db, COL), orderBy("createdAtMs", "desc"));
  onSnapshot(q, (snap) => {
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // draft가 없는 애들만 정리 (작성중인 건 유지)
    for(const { id } of all){
      if(!draftResult.has(id)) continue;
      // 그대로 둠
    }
    render();
  });
});

signInAnonymously(auth);
