// ✅ script.js 최종본
// - 차트/이름 입력 정상화(신규 저장 정상)
// - 과거 뒤집힌 데이터도 화면/검색/엑셀에서 자동 보정
// - 상태 헤더 필터
// - 탭: 총/대기 인원 표시
// - 검사항목(exam) 표에서 드롭다운 수정 가능
// - 엑셀: 검사날짜 + (차트번호, 이름, 검사항목, 검사결과, 추적검사시기)

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

/* =========================
   ✅ 차트/이름 뒤집힘 자동 보정 (화면/검색/엑셀 공용)
========================= */
function normChart(it){
  const a = String(it.chart || "").trim();
  const b = String(it.name || "").trim();
  const isNum = (s) => /^\d+$/.test(s);

  if(isNum(a)) return a;
  if(isNum(b)) return b;
  return a || b;
}
function normName(it){
  const a = String(it.chart || "").trim();
  const b = String(it.name || "").trim();
  const isNum = (s) => /^\d+$/.test(s);

  if(isNum(a) && !isNum(b)) return b;
  if(isNum(b) && !isNum(a)) return a;
  return b || a;
}

/* =========================
   ✅ 검사항목 드롭다운 옵션
========================= */
const EXAM_OPTIONS = [
  // CT
  "C-CT","A-CT","B-CT","Cardiac CT","CECA CT","dynamic CT","기타 CT",
  // MRI
  "B-MRI","B-MRA","B-MRI&MRA","복부MRI","관절MRI","SPINE MRI",
  // 초음파
  "HU","IU","TU","TTE","BU",
  // 검진
  "건강검진","위내시경","대장내시경","기타"
];

function examOptionsHtml(selected){
  const cur = String(selected || "").trim();
  return EXAM_OPTIONS.map(v => {
    const sel = (v === cur) ? "selected" : "";
    return `<option value="${escAttr(v)}" ${sel}>${v}</option>`;
  }).join("");
}

let all = [];
let ready = false;
let activeCat = null;      // null | "영상" | "심장초음파" | "초음파" | "검진"
let showTrash = false;     // 휴지통 보기 토글
let activeStatus = "";     // "" | "__BLANK__" | "대기" | "진행중" | "완료"

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

  // ✅ 정상: 차트번호 input(id=chart), 이름 input(id=name)
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
      deleted: false,
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

/* =========================
   탭 요약 (총 + 대기 인원)
========================= */
function renderSummary(rowsForDateAll){
  const box = $("summaryBox");
  if(!box) return;

  const normalRows = rowsForDateAll.filter(x => !x.deleted);

  const countFor = (catKey) => {
    const rows = normalRows.filter(it => {
      if(!catKey) return true;
      return getItemCategoryOrNull(it) === catKey;
    });
    const total = rows.length;
    const waiting = rows.filter(it => (it.status || "") === "대기").length;
    return { total, waiting };
  };

  const cAll   = countFor(null);
  const cImg   = countFor("영상");
  const cEcho  = countFor("심장초음파");
  const cUS    = countFor("초음파");
  const cCheck = countFor("검진");

  const trashCount = rowsForDateAll.filter(x => !!x.deleted).length;

  const tabs = [
    { key: null,         label:"전체",        total: cAll.total,    waiting: cAll.waiting },
    { key: "영상",       label:"영상",        total: cImg.total,    waiting: cImg.waiting },
    { key: "심장초음파", label:"심장초음파",  total: cEcho.total,   waiting: cEcho.waiting },
    { key: "초음파",     label:"초음파",      total: cUS.total,     waiting: cUS.waiting },
    { key: "검진",       label:"검진",        total: cCheck.total,  waiting: cCheck.waiting },
    { key: "__TRASH__",  label:"휴지통",      total: trashCount,    waiting: null }
  ];

  box.innerHTML = `
    <div class="tabBar">
      ${tabs.map(t => {
        const isTrash = t.key === "__TRASH__";
        const isActive = isTrash ? showTrash : (!showTrash && activeCat === t.key);

        const subHtml = isTrash
          ? `<span class="sub">총 ${t.total}명</span>`
          : `<span class="sub">총 ${t.total}명 · 대기 ${t.waiting}명</span>`;

        return `
          <button class="tabBtn ${isActive ? "active" : ""}" data-cat="${t.key ?? ""}">
            ${t.label}
            ${subHtml}
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
      if(!activeStatus) return true;
      if(activeStatus === "__BLANK__") return !(it.status || "");
      return (it.status || "") === activeStatus;
    })
    .filter(it => {
      if(!qText) return true;
      const hay = `${normName(it)} ${normChart(it)} ${it.exam}`.toLowerCase();
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

    const safeName  = escAttr(normName(it));
    const safeChart = escAttr(normChart(it));

    const cat = (it.category || "").trim();

    const statusColor =
      it.status === "진행중" ? "red" :
      it.status === "완료" ? "blue" :
      "black";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${it.examDate || ""}</td>

      <td>
        <input data-role="chart" data-id="${it.id}" value="${safeChart}" style="width:100%; box-sizing:border-box;" ${showTrash ? "disabled" : ""}>
      </td>

      <td>
        <input data-role="name" data-id="${it.id}" value="${safeName}" style="width:100%; box-sizing:border-box;" ${showTrash ? "disabled" : ""}>
      </td>

      <td>
        ${
          showTrash
            ? (it.exam || "")
            : `
              <select data-role="exam" data-id="${it.id}" style="width:100%; height:32px; font-size:14px; border:1px solid #999; border-radius:8px; padding:4px 8px; box-sizing:border-box;">
                ${examOptionsHtml(it.exam)}
              </select>
            `
        }
      </td>

      <td>
        <select data-role="category" data-id="${it.id}" ${showTrash ? "disabled" : ""}>
          <option value="" ${cat==="" ? "selected" : ""}>선택</option>
          <option value="영상" ${cat==="영상" ? "selected" : ""}>영상</option>
          <option value="심장초음파" ${cat==="심장초음파" ? "selected" : ""}>심장초음파</option>
          <option value="초음파" ${cat==="초음파" ? "selected" : ""}>초음파</option>
          <option value="검진" ${cat==="검진" ? "selected" : ""}>검진</option>
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
   엑셀 저장
   - 검사날짜 + 차트번호 + 이름 + 검사항목 + 검사결과 + 추적검사시기
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
      if(!activeStatus) return true;
      if(activeStatus === "__BLANK__") return !(it.status || "");
      return (it.status || "") === activeStatus;
    })
    .filter(it => {
      if(!qText) return true;
      const hay = `${normName(it)} ${normChart(it)} ${it.exam}`.toLowerCase();
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
  const statusName =
    !activeStatus ? "상태전체" :
    activeStatus === "__BLANK__" ? "공백" :
    activeStatus;

  const aoa = [
    ["검사날짜","차트번호","이름","검사항목","검사결과","추적검사시기"]
  ];

  for(const it of rows){
    aoa.push([
      it.examDate || "",
      normChart(it),
      normName(it),
      it.exam || "",
      it.result || "",
      it.followUp || ""
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Worklist");

  const fileName = `속안심_Worklist_${selectedDate}_${tabName}_${statusName}.xlsx`;
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

  // ✅ 상태 헤더 필터
  $("statusFilterTh")?.addEventListener("change", () => {
    activeStatus = $("statusFilterTh").value || "";
    render();
  });

  // ✅ 엑셀 저장
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

  // ✅ 검사항목 변경 저장
  $("list")?.addEventListener("change", async (e) => {
    const sel = e.target.closest('select[data-role="exam"]');
    if(!sel) return;
    if(showTrash) return;

    const id = sel.dataset.id;
    const val = (sel.value || "").trim();

    try{
      await updateDoc(doc(db, COL, id), { exam: val });
    }catch(err){
      console.error(err);
      alert("검사항목 저장에 실패했습니다.");
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

    // 접수: "" -> 대기 / 대기 -> ""
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

  // ✅ 자동저장: 차트/이름/결과/추적
  $("list")?.addEventListener("focusout", async (e) => {
    if(showTrash) return;

    const chartInput = e.target.closest('input[data-role="chart"]');
    if(chartInput){
      const id = chartInput.dataset.id;
      const it = all.find(x => x.id === id);
      if(!it) return;

      const val = (chartInput.value ?? "").trim();
      if(!val){
        alert("차트번호는 빈값으로 저장할 수 없습니다.");
        chartInput.value = normChart(it);
        return;
      }
      if(val !== String(it.chart || "").trim()){
        try{ await updateDoc(doc(db, COL, id), { chart: val }); }
        catch(err){ console.error(err); alert("차트번호 저장에 실패했습니다."); }
      }
      return;
    }

    const nameInput = e.target.closest('input[data-role="name"]');
    if(nameInput){
      const id = nameInput.dataset.id;
      const it = all.find(x => x.id === id);
      if(!it) return;

      const val = (nameInput.value ?? "").trim();
      if(!val){
        alert("이름은 빈값으로 저장할 수 없습니다.");
        nameInput.value = normName(it);
        return;
      }
      if(val !== String(it.name || "").trim()){
        try{ await updateDoc(doc(db, COL, id), { name: val }); }
        catch(err){ console.error(err); alert("이름 저장에 실패했습니다."); }
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