// ✅ script.js 최종본 (휴지통 기능 + 엑셀 저장 포함)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  query, onSnapshot, serverTimestamp, where, getDocs, limit, orderBy,
  writeBatch, deleteField
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
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }catch{
    return "";
  }
}
function getSelectedExams(){
  return Array.from(document.querySelectorAll(".examChk:checked")).map(x => x.value);
}
function getSelectedCategoryOrNull(){
  const el = document.querySelector('input[name="category"]:checked');
  return el ? el.value : null;
}
function getItemCategoryOrNull(it){
  const c = String(it.category || "").trim();
  return c ? c : null;
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
let activeCat = null;     // null | "영상" | "심장초음파" | "초음파"
let showTrash = false;    // ✅ 휴지통 보기 토글

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
  const category = getSelectedCategoryOrNull();

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
    const payload = {
      name,
      chart,
      exam,
      examDate,
      status: "",
      visitAt: null,
      startAt: null,
      finishAt: null,
      result: "",
      followUp: "",
      deleted: false,           // ✅ 휴지통 플래그
      deletedAt: null,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    };
    if(category) payload.category = category;
    await addDoc(collection(db, COL), payload);
  }

  $("name").value = "";
  $("chart").value = "";
  document.querySelectorAll(".examChk").forEach(x => x.checked = false);
  document.querySelectorAll('input[name="category"]').forEach(r => r.checked = false);
}

function renderSummary(rowsForDateAll){
  const box = $("summaryBox");
  if(!box) return;

  const base = { "영상":0, "심장초음파":0, "초음파":0 };
  for(const it of rowsForDateAll){
    if(it.deleted) continue; // ✅ 요약은 기본적으로 정상항목 기준
    const cat = getItemCategoryOrNull(it);
    if(!cat) continue;
    if(base[cat] === undefined) continue;
    base[cat] += 1;
  }

  const selectedDate = $("examDate")?.value || todayStr();
  const total = rowsForDateAll.filter(x => !x.deleted).length;
  const trashCount = rowsForDateAll.filter(x => !!x.deleted).length;

  const tabs = [
    { key: null,         label:"전체",        count: total },
    { key: "영상",       label:"영상",        count: base["영상"] },
    { key: "심장초음파", label:"심장초음파",  count: base["심장초음파"] },
    { key: "초음파",     label:"초음파",      count: base["초음파"] },
    { key: "__TRASH__",  label:"휴지통",      count: trashCount }
  ];

  box.innerHTML = `
    <div class="tabBar">
      ${tabs.map(t => {
        const isTrash = t.key === "__TRASH__";
        const isActive = isTrash ? showTrash : (!showTrash && activeCat === t.key);
        return `
          <button class="tabBtn ${isActive ? "active" : ""}" data-cat="${t.key ?? ""}">
            ${t.label}
            <span class="sub">총 ${t.count}명</span>
          </button>
        `;
      }).join("")}
    </div>
  `;

  box.onclick = (e) => {
    const btn = e.target.closest(".tabBtn");
    if(!btn) return;
    const cat = btn.dataset.cat || null;

    if(cat === "__TRASH__"){
      showTrash = true;
      activeCat = null;
      render();
      return;
    }
    showTrash = false;
    activeCat = (cat === "" ? null : cat);
    render();
  };
}

function render(){
  const qText = (($("q")?.value || "").trim()).toLowerCase();
  const selectedDate = $("examDate")?.value || todayStr();
  const list = $("list");
  list.innerHTML = "";

  const rowsForDateAll = all.filter(it => it.examDate === selectedDate);
  renderSummary(rowsForDateAll);

  const rowsForDate = rowsForDateAll
    .filter(it => showTrash ? !!it.deleted : !it.deleted);

  const filtered = rowsForDate
    .filter(it => {
      if(showTrash) return true;
      if(!activeCat) return true;
      return getItemCategoryOrNull(it) === activeCat;
    })
    .filter(it => {
      if(!qText) return true;
      const hay = `${it.name} ${it.chart} ${it.exam}`.toLowerCase();
      return hay.includes(qText);
    });

  if(filtered.length === 0){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="12" class="muted">표시할 항목이 없습니다.</td>`;
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
    const safeName  = escAttr(it.name || "");
    const safeChart = escAttr(it.chart || "");

    const cat = (it.category || "").trim();

    const statusColor =
      it.status === "진행중" ? "red" :
      it.status === "완료" ? "blue" :
      "black";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.examDate || ""}</td>

      <td>
        <input data-role="name" data-id="${it.id}" value="${safeName}" style="width:100%; box-sizing:border-box;" ${showTrash ? "disabled" : ""}>
      </td>
      <td>
        <input data-role="chart" data-id="${it.id}" value="${safeChart}" style="width:100%; box-sizing:border-box;" ${showTrash ? "disabled" : ""}>
      </td>

      <td>${it.exam || ""}</td>

      <td>
        <select data-role="category" data-id="${it.id}" ${showTrash ? "disabled" : ""}>
          <option value="" ${cat==="" ? "selected" : ""}>선택</option>
          <option value="영상" ${cat==="영상" ? "selected" : ""}>영상</option>
          <option value="심장초음파" ${cat==="심장초음파" ? "selected" : ""}>심장초음파</option>
          <option value="초음파" ${cat==="초음파" ? "selected" : ""}>초음파</option>
        </select>
      </td>

      <td style="color:${statusColor};">${it.status || ""}</td>

      <td><button data-act="visit" data-id="${it.id}" ${showTrash ? "disabled" : ""}>${visitText}</button></td>
      <td><button data-act="start" data-id="${it.id}" ${showTrash ? "disabled" : ""}>${startText}</button></td>
      <td><button data-act="finish" data-id="${it.id}" ${showTrash ? "disabled" : ""}>${finishText}</button></td>

      <td>
        <input data-role="result" data-id="${it.id}" value="${safeResult}" placeholder="결과 입력" ${showTrash ? "disabled" : ""}>
      </td>

      <td>
        <input data-role="followUp" data-id="${it.id}" value="${safeFollow}" placeholder="" ${showTrash ? "disabled" : ""}>
      </td>

      <td>
        ${
          showTrash
            ? `
              <button data-act="restore" data-id="${it.id}">복구</button>
              <button data-act="purge" data-id="${it.id}">영구삭제</button>
            `
            : `<button data-act="trash" data-id="${it.id}">삭제</button>`
        }
      </td>
    `;
    list.appendChild(tr);
  }
}

/* =========================
   상태 흐름
========================= */
async function markWait(id){
  await updateDoc(doc(db, COL, id), { status: "대기", visitAt: serverTimestamp() });
}
async function resetToBlank(id){
  await updateDoc(doc(db, COL, id), { status: "", visitAt: null, startAt: null, finishAt: null });
}
async function startExam(id){
  await updateDoc(doc(db, COL, id), { status: "진행중", startAt: serverTimestamp() });
}
async function finishExam(id){
  await updateDoc(doc(db, COL, id), { status: "완료", finishAt: serverTimestamp() });
}
async function resetStart(id){
  await updateDoc(doc(db, COL, id), { status: "대기", startAt: null, finishAt: null });
}
async function resetFinish(id){
  await updateDoc(doc(db, COL, id), { status: "진행중", finishAt: null });
}

/* =========================
   휴지통 동작
========================= */
async function moveToTrash(id){
  await updateDoc(doc(db, COL, id), { deleted: true, deletedAt: serverTimestamp() });
}
async function restoreFromTrash(id){
  await updateDoc(doc(db, COL, id), { deleted: false, deletedAt: null });
}
async function purgeForever(id){
  await deleteDoc(doc(db, COL, id));
}

/* =========================
   ✅ 엑셀 저장
   - 현재 선택 날짜 + 현재 탭/검색 필터 기준 저장
========================= */
function getFilteredRowsForExport(){
  const qText = (($("q")?.value || "").trim()).toLowerCase();
  const selectedDate = $("examDate")?.value || todayStr();

  const rowsForDateAll = all.filter(it => it.examDate === selectedDate);

  const rowsForDate = rowsForDateAll
    .filter(it => showTrash ? !!it.deleted : !it.deleted);

  const filtered = rowsForDate
    .filter(it => {
      if(showTrash) return true;
      if(!activeCat) return true;
      return getItemCategoryOrNull(it) === activeCat;
    })
    .filter(it => {
      if(!qText) return true;
      const hay = `${it.name} ${it.chart} ${it.exam}`.toLowerCase();
      return hay.includes(qText);
    });

  return filtered;
}

function exportXlsx(){
  const XLSX = window.XLSX;
  if(!XLSX){
    alert("엑셀 저장 모듈을 불러오지 못했습니다.\n인터넷 연결 또는 로딩 순서를 확인해 주세요.");
    return;
  }

  const rows = getFilteredRowsForExport();
  if(!rows.length){
    alert("저장할 데이터가 없습니다.");
    return;
  }

  const selectedDate = $("examDate")?.value || todayStr();
  const tabName = showTrash ? "휴지통" : (activeCat ? activeCat : "전체");

  const aoa = [
    ["검사날짜","차트번호","이름","검사항목","분류","상태","접수시간","Start","Finish","검사결과","추적검사시기","삭제여부"]
  ];

  for(const it of rows){
    aoa.push([
      it.examDate || "",
      it.chart || "",
      it.name || "",
      it.exam || "",
      (it.category || ""),
      (it.status || ""),
      fmtTime(it.visitAt) || "",
      fmtTime(it.startAt) || "",
      fmtTime(it.finishAt) || "",
      it.result || "",
      it.followUp || "",
      it.deleted ? "Y" : ""
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Worklist");

  const fileName = `속안심_Worklist_${selectedDate}_${tabName}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

/* =========================
   이벤트
========================= */
function wireEvents(){
  $("btnAdd")?.addEventListener("click", addItem);
  $("btnSearch")?.addEventListener("click", render);
  $("btnReset")?.addEventListener("click", () => { $("q").value = ""; render(); });
  $("examDate")?.addEventListener("change", render);

  // ✅ 엑셀 저장 버튼 연결 (기존 코드에 없어서 저장이 안 됐던 부분)
  $("btnExportXlsx")?.addEventListener("click", exportXlsx);

  // ✅ 분류 변경 저장(빈값이면 필드 삭제)
  $("list")?.addEventListener("change", async (e) => {
    const sel = e.target.closest('select[data-role="category"]');
    if(!sel) return;
    if(showTrash) return;

    const id = sel.dataset.id;
    const val = (sel.value || "").trim();

    try{
      if(!val) await updateDoc(doc(db, COL, id), { category: deleteField() });
      else await updateDoc(doc(db, COL, id), { category: val });
    }catch(err){
      console.error(err);
      alert("분류 저장에 실패했습니다.");
    }
  });

  // draft (결과/추적)
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

  // 클릭 버튼들
  $("list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if(!btn) return;

    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if(!act || !id) return;

    const it = all.find(x => x.id === id);
    if(!it) return;

    if(act === "trash"){
      if(!confirm("휴지통으로 이동할까요?")) return;
      await moveToTrash(id);
      return;
    }

    if(act === "restore"){
      await restoreFromTrash(id);
      return;
    }

    if(act === "purge"){
      if(!confirm("영구삭제할까요? (복구 불가)")) return;
      await purgeForever(id);
      return;
    }

    if(showTrash) return;

    // ✅ 접수 버튼: 미접수("") -> 대기 / 대기 -> 공란(되돌림)
    if(act === "visit"){
      if(!it.status){ await markWait(id); return; }
      if(it.status === "대기"){ await resetToBlank(id); return; }
      return;
    }

    if(act === "start"){
      if(it.status === "대기"){ await startExam(id); return; }
      if(it.status === "진행중" || it.status === "완료"){ await resetStart(id); return; }
      return;
    }

    if(act === "finish"){
      if(it.status === "진행중"){ await finishExam(id); return; }
      if(it.status === "완료"){ await resetFinish(id); return; }
      return;
    }
  });

  // Enter -> blur
  $("list")?.addEventListener("keydown", (e) => {
    const input = e.target.closest('input[data-role="result"], input[data-role="followUp"], input[data-role="name"], input[data-role="chart"]');
    if(!input) return;
    if(e.key !== "Enter") return;
    e.preventDefault();
    input.blur();
  });

  // ✅ 자동저장: 이름/차트/결과/추적 (휴지통에서는 동작 X)
  $("list")?.addEventListener("focusout", async (e) => {
    if(showTrash) return;

    const nameInput = e.target.closest('input[data-role="name"]');
    if(nameInput){
      const id = nameInput.dataset.id;
      const it = all.find(x => x.id === id);
      if(!it) return;

      const val = (nameInput.value ?? "").trim();
      if(!val){
        alert("이름은 빈값으로 저장할 수 없습니다.");
        nameInput.value = it.name || "";
        return;
      }
      if(val !== (it.name || "")){
        try{ await updateDoc(doc(db, COL, id), { name: val }); }
        catch(err){ console.error(err); alert("이름 저장에 실패했습니다."); }
      }
      return;
    }

    const chartInput = e.target.closest('input[data-role="chart"]');
    if(chartInput){
      const id = chartInput.dataset.id;
      const it = all.find(x => x.id === id);
      if(!it) return;

      const val = (chartInput.value ?? "").trim();
      if(!val){
        alert("차트번호는 빈값으로 저장할 수 없습니다.");
        chartInput.value = it.chart || "";
        return;
      }
      if(val !== (it.chart || "")){
        try{ await updateDoc(doc(db, COL, id), { chart: val }); }
        catch(err){ console.error(err); alert("차트번호 저장에 실패했습니다."); }
      }
      return;
    }

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

// 초기 세팅
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