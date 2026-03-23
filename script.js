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

function normPhone(it){
  return String(it.phone || "").trim();
}

const EXAM_OPTIONS = [
  "C-CT","A-CT","B-CT","Cardiac CT","CECA CT","dynamic CT","기타 CT",
  "B-MRI","B-MRA","B-MRI&MRA","복부MRI","관절MRI","SPINE MRI",
  "HU","IU(초음파)","IU(심초음파)","TU","TTE","BU","기타(초음파)",
  "건강검진","위내시경","대장내시경","위내시경(자부담)","대장내시경(자부담)","기타(검진)"
];

function examOptionsHtml(selected){
  const cur = String(selected || "").trim();
  return EXAM_OPTIONS.map(v => {
    const sel = (v === cur) ? "selected" : "";
    return `<option value="${escAttr(v)}" ${sel}>${v}</option>`;
  }).join("");
}

const CATEGORY_OPTIONS = ["", "영상", "심장초음파", "초음파", "검진"];

function categoryOptionsHtml(selected){
  const cur = String(selected || "").trim();
  return CATEGORY_OPTIONS.map(v => {
    const sel = (v === cur) ? "selected" : "";
    const label = v || "선택";
    return `<option value="${escAttr(v)}" ${sel}>${label}</option>`;
  }).join("");
}

function inferCategoryFromExam(exam){
  const e = String(exam || "").trim();

  const imageSet = [
    "C-CT","A-CT","B-CT","Cardiac CT","CECA CT","dynamic CT","기타 CT",
    "B-MRI","B-MRA","B-MRI&MRA","복부MRI","관절MRI","SPINE MRI"
  ];
  const echoSet = ["TTE"];
  const usSet = ["HU","TU","IU(초음파)","IU(심초음파)","BU","기타(초음파)"];
  const checkSet = ["건강검진","위내시경","대장내시경","기타(검진)"];

  if(imageSet.includes(e)) return "영상";
  if(echoSet.includes(e)) return "심장초음파";
  if(usSet.includes(e)) return "초음파";
  if(checkSet.includes(e)) return "검진";

  return null;
}

function getStateUi(it){
  const s = String(it.status || "");
  const visitTime = fmtTime(it.visitAt);
  const startTime = fmtTime(it.startAt);
  const finishTime = fmtTime(it.finishAt);

  if(!s){
    return {
      nextAct: "next",
      label: "접수",
      className: "empty"
    };
  }

  if(s === "대기"){
    return {
      nextAct: "next",
      label: `${visitTime} 대기`,
      className: "waiting"
    };
  }

  if(s === "진행중"){
    return {
      nextAct: "next",
      label: `${startTime} 진행중`,
      className: "running"
    };
  }

   if(s === "완료"){
    return {
      nextAct: "next",
      label: `${finishTime} 완료`,
      className: "done"
    };
  }

  return {
    nextAct: "next",
    label: "접수",
    className: "empty"
  };
}

/* 등록 시: 차트번호 + 이름이 같은 이전 기록의 전화번호 가져오기 */
async function findSavedPhone(chart, name){
  const chartNo = String(chart || "").trim();
  const patientName = String(name || "").trim();

  if(!chartNo || !patientName) return "";

  try{
    const q = query(
      collection(db, COL),
      where("chart", "==", chartNo),
      where("name", "==", patientName),
      limit(20)
    );

    const snap = await getDocs(q);
    if(snap.empty) return "";

    const docs = snap.docs
      .map(d => d.data())
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

    for(const data of docs){
      const phone = String(data.phone || "").trim();
      if(phone) return phone;
    }

    return "";
  }catch(err){
    console.error("전화번호 조회 실패:", err);
    return "";
  }
}

let all = [];
let ready = false;
let activeCat = null;
let showTrash = false;
let activeStatus = "";

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
  const selectedCategory = getSelectedCategoryOrNull();

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

  const savedPhone = await findSavedPhone(chart, name);

  for(const exam of exams){
    const autoCategory = selectedCategory || inferCategoryFromExam(exam);

    const payload = {
      name,
      chart,
      phone: savedPhone || "",
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

    if(autoCategory) payload.category = autoCategory;
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

  const rowsForDate = rowsForDateAll.filter(it => showTrash ? !!it.deleted : !it.deleted);

  const filtered = rowsForDate
    .filter(it => {
      if(showTrash) return true;
      if(!activeCat) return true;
      return getItemCategoryOrNull(it) === activeCat;
    })
    .filter(it => {
      if(!activeStatus) return true;
      return (it.status || "") === activeStatus;
    })
    .filter(it => {
      if(!qText) return true;
      const hay = `${normName(it)} ${normChart(it)} ${it.exam}`.toLowerCase();
      return hay.includes(qText);
    });

  if(filtered.length === 0){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="muted">표시할 항목이 없습니다.</td>`;
    list.appendChild(tr);
    return;
  }

  for(const it of filtered){
    const resultVal = draftResult.has(it.id) ? draftResult.get(it.id) : (it.result || "");
    const followVal = draftFollow.has(it.id) ? draftFollow.get(it.id) : (it.followUp || "");

    const safeResult = escAttr(resultVal);
    const safeFollow = escAttr(followVal);
    const safeName  = escAttr(normName(it));
    const safeChart = escAttr(normChart(it));
    const safePhone = escAttr(normPhone(it));
    const safeCategory = escAttr(getItemCategoryOrNull(it) || "");
    const stateUi = getStateUi(it);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        ${
          showTrash
            ? (safeCategory || "")
            : `
              <select data-role="category" data-id="${it.id}">
                ${categoryOptionsHtml(getItemCategoryOrNull(it) || "")}
              </select>
            `
        }
      </td>

      <td>
        <input data-role="chart" data-id="${it.id}" value="${safeChart}" ${showTrash ? "disabled" : ""}>
      </td>

      <td>
        <input data-role="name" data-id="${it.id}" value="${safeName}" ${showTrash ? "disabled" : ""}>
      </td>

      <td>
        ${
          showTrash
            ? (it.exam || "")
            : `
              <select data-role="exam" data-id="${it.id}">
                ${examOptionsHtml(it.exam)}
              </select>
            `
        }
      </td>

      <td>
        ${
          showTrash
            ? `<span style="font-weight:600;">${stateUi.label}</span>`
            : `
              <div class="stateCell">
                <button
  class="stateChip ${stateUi.className}"
  data-act="${stateUi.nextAct}"
  data-id="${it.id}"
>
  ${stateUi.label}
</button>
              </div>
            `
        }
      </td>

      <td>
        <input data-role="result" data-id="${it.id}" value="${safeResult}" placeholder="결과 입력" ${showTrash ? "disabled" : ""}>
      </td>

      <td>
  <input data-role="followUp" data-id="${it.id}" value="${safeFollow}" ${showTrash ? "disabled" : ""}>
</td>

<td>
  <input data-role="phone" data-id="${it.id}" value="${safePhone}" placeholder="핸드폰번호" ${showTrash ? "disabled" : ""}>
</td>

<td>
  ${
    showTrash
      ? `
        <button data-act="restore" data-id="${it.id}">복구</button>
        <button data-act="purge" data-id="${it.id}">삭제</button>
      `
      : `
        <div class="manageBtns">
          <button data-act="trash" data-id="${it.id}">삭제</button>
        </div>
      `
  }
</td>
    `;
    list.appendChild(tr);
  }
}

async function moveToTrash(id){
  await updateDoc(doc(db, COL, id), { deleted: true, deletedAt: serverTimestamp() });
}

async function restoreFromTrash(id){
  await updateDoc(doc(db, COL, id), { deleted: false, deletedAt: null });
}

async function purgeForever(id){
  await deleteDoc(doc(db, COL, id));
}

function getFilteredRowsForExport(){
  const qText = (($("q")?.value || "").trim()).toLowerCase();
  const selectedDate = $("examDate")?.value || todayStr();

  const rowsForDateAll = all.filter(it => it.examDate === selectedDate);
  const rowsForDate = rowsForDateAll.filter(it => showTrash ? !!it.deleted : !it.deleted);

  return rowsForDate
    .filter(it => {
      if(showTrash) return true;
      if(!activeCat) return true;
      return getItemCategoryOrNull(it) === activeCat;
    })
    .filter(it => {
      if(!activeStatus) return true;
      return (it.status || "") === activeStatus;
    })
    .filter(it => {
      if(!qText) return true;
      const hay = `${normName(it)} ${normChart(it)} ${it.exam}`.toLowerCase();
      return hay.includes(qText);
    });
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
  const statusName = !activeStatus ? "상태전체" : activeStatus;

const aoa = [
  ["차트번호","핸드폰번호","이름","검사날짜","검사항목","결과","추적검사시기"]
];

for (const it of rows) {
  aoa.push([
    normChart(it),
    it.phone || "",
    normName(it),
    it.examDate || "",
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

function wireEvents(){
  $("btnAdd")?.addEventListener("click", addItem);
  $("btnSearch")?.addEventListener("click", render);
  $("btnReset")?.addEventListener("click", () => {
    $("q").value = "";
    render();
  });
  $("examDate")?.addEventListener("change", render);

  $("statusFilterTh")?.addEventListener("change", () => {
    activeStatus = $("statusFilterTh").value || "";
    render();
  });

  $("btnExportXlsx")?.addEventListener("click", exportXlsx);

  $("list")?.addEventListener("change", async (e) => {
    const catSel = e.target.closest('select[data-role="category"]');
    if(catSel){
      if(showTrash) return;

      const id = catSel.dataset.id;
      const val = (catSel.value || "").trim();

      try{
        await updateDoc(doc(db, COL, id), { category: val || null });
      }catch(err){
        console.error(err);
        alert("분류 저장에 실패했습니다.");
      }
      return;
    }

    const examSel = e.target.closest('select[data-role="exam"]');
    if(examSel){
      if(showTrash) return;

      const id = examSel.dataset.id;
      const val = (examSel.value || "").trim();
      const autoCategory = inferCategoryFromExam(val);

      try{
        const payload = { exam: val };
        if(autoCategory) payload.category = autoCategory;
        await updateDoc(doc(db, COL, id), payload);
      }catch(err){
        console.error(err);
        alert("검사항목 저장에 실패했습니다.");
      }
      return;
    }
  });

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

if(act === "next"){
  if(!it.status){
    await updateDoc(doc(db, COL, id), {
      status: "대기",
      visitAt: serverTimestamp()
    });
    return;
  }

  if(it.status === "대기"){
    await updateDoc(doc(db, COL, id), {
      status: "진행중",
      startAt: serverTimestamp()
    });
    return;
  }

  if(it.status === "진행중"){
    await updateDoc(doc(db, COL, id), {
      status: "완료",
      finishAt: serverTimestamp()
    });
    return;
  }

  if(it.status === "완료"){
    await updateDoc(doc(db, COL, id), {
      status: "",
      visitAt: null,
      startAt: null,
      finishAt: null
    });
    return;
  }
}
  });

  $("list")?.addEventListener("keydown", (e) => {
    const input = e.target.closest('input[data-role="result"], input[data-role="followUp"], input[data-role="name"], input[data-role="chart"], input[data-role="phone"]');
    if(!input) return;
    if(e.key !== "Enter") return;
    e.preventDefault();
    input.blur();
  });

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
        try{
          await updateDoc(doc(db, COL, id), { chart: val });
        }catch(err){
          console.error(err);
          alert("차트번호 저장에 실패했습니다.");
        }
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
        try{
          await updateDoc(doc(db, COL, id), { name: val });
        }catch(err){
          console.error(err);
          alert("이름 저장에 실패했습니다.");
        }
      }
      return;
    }

    /* 기존 기능 유지: 한 줄에 전화번호 입력하면 같은 차트번호 전체 반영 */
    const phoneInput = e.target.closest('input[data-role="phone"]');
    if(phoneInput){
      const id = phoneInput.dataset.id;
      const it = all.find(x => x.id === id);
      if(!it) return;

      const val = (phoneInput.value ?? "").trim();

      try{
        const sameChart = all.filter(
          x => String(x.chart || "").trim() === String(it.chart || "").trim()
        );

        const batch = writeBatch(db);
        sameChart.forEach(row => {
          const ref = doc(db, COL, row.id);
          batch.update(ref, { phone: val });
        });

        await batch.commit();
      }catch(err){
        console.error(err);
        alert("핸드폰번호 저장에 실패했습니다.");
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

$("examDate").value = todayStr();
wireEvents();

onAuthStateChanged(auth, async (user) => {
  if(!user) return;
  ready = true;

  try{
    await cleanupOldDocs();
  }catch(err){
    console.error("cleanup failed:", err);
  }

  const q = query(collection(db, COL), orderBy("createdAtMs", "desc"));
  onSnapshot(q, (snap) => {
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  });
});

signInAnonymously(auth);