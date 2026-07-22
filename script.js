import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  onSnapshot,
  serverTimestamp,
  where,
  getDocs,
  limit,
  orderBy,
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
const KEEP_MONTHS = 6;

const $ = (id) => document.getElementById(id);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayStr() {
  const d = new Date();

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}`;
}

function fmtTime(ts) {
  if (!ts) return "";

  try {
    const d = ts.toDate();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function getSelectedExams() {
  return Array.from(
    document.querySelectorAll(".examChk:checked")
  ).map((x) => x.value);
}

function getSelectedCategoryOrNull() {
  const el = document.querySelector(
    'input[name="category"]:checked'
  );

  return el ? el.value : null;
}

function getItemCategoryOrNull(it) {
  const category = String(it.category || "").trim();
  return category || null;
}

function escAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normChart(it) {
  const chart = String(it.chart || "").trim();
  const name = String(it.name || "").trim();
  const isNumber = (value) => /^\d+$/.test(value);

  if (isNumber(chart)) return chart;
  if (isNumber(name)) return name;

  return chart || name;
}

function normName(it) {
  const chart = String(it.chart || "").trim();
  const name = String(it.name || "").trim();
  const isNumber = (value) => /^\d+$/.test(value);

  if (isNumber(chart) && !isNumber(name)) return name;
  if (isNumber(name) && !isNumber(chart)) return chart;

  return name || chart;
}

const EXAM_OPTIONS = [
  "C-CT",
  "A-CT",
  "B-CT",
  "Cardiac CT",
  "CECA CT",
  "dynamic CT",
  "기타 CT",
  "B-MRI",
  "B-MRA",
  "B-MRI&MRA",
  "복부MRI",
  "관절MRI",
  "SPINE MRI",
  "HU",
  "IU(초음파)",
  "IU(심초음파)",
  "TU",
  "TTE",
  "BU",
  "기타(초음파)",
  "건강검진",
  "위내시경",
  "대장내시경",
  "위내시경(자부담)",
  "대장내시경(자부담)",
  "기타(검진)"
];

function examOptionsHtml(selected) {
  const current = String(selected || "").trim();

  return EXAM_OPTIONS.map((value) => {
    const selectedText =
      value === current ? "selected" : "";

    return `
      <option value="${escAttr(value)}" ${selectedText}>
        ${value}
      </option>
    `;
  }).join("");
}

const CATEGORY_OPTIONS = [
  "",
  "영상",
  "심장초음파",
  "초음파",
  "검진"
];

function categoryOptionsHtml(selected) {
  const current = String(selected || "").trim();

  return CATEGORY_OPTIONS.map((value) => {
    const selectedText =
      value === current ? "selected" : "";

    const label = value || "선택";

    return `
      <option value="${escAttr(value)}" ${selectedText}>
        ${label}
      </option>
    `;
  }).join("");
}

function inferCategoryFromExam(exam) {
  const value = String(exam || "").trim();

  const imageSet = [
    "C-CT",
    "A-CT",
    "B-CT",
    "Cardiac CT",
    "CECA CT",
    "dynamic CT",
    "기타 CT",
    "B-MRI",
    "B-MRA",
    "B-MRI&MRA",
    "복부MRI",
    "관절MRI",
    "SPINE MRI"
  ];

  const echoSet = ["TTE"];

  const ultrasoundSet = [
    "HU",
    "TU",
    "IU(초음파)",
    "IU(심초음파)",
    "BU",
    "기타(초음파)"
  ];

  const checkupSet = [
    "건강검진",
    "위내시경",
    "위내시경(자부담)",
    "대장내시경",
    "대장내시경(자부담)",
    "기타(검진)"
  ];

  if (imageSet.includes(value)) return "영상";
  if (echoSet.includes(value)) return "심장초음파";
  if (ultrasoundSet.includes(value)) return "초음파";
  if (checkupSet.includes(value)) return "검진";

  return null;
}

function getStateUi(it) {
  const status = String(it.status || "");
  const visitTime = fmtTime(it.visitAt);
  const startTime = fmtTime(it.startAt);
  const finishTime = fmtTime(it.finishAt);

  if (!status) {
    return {
      nextAct: "next",
      label: "접수",
      className: "empty"
    };
  }

  if (status === "대기") {
    return {
      nextAct: "next",
      label: `${visitTime} 대기`,
      className: "waiting"
    };
  }

  if (status === "진행중") {
    return {
      nextAct: "next",
      label: `${startTime} 진행중`,
      className: "running"
    };
  }

  if (status === "완료") {
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

let all = [];
let ready = false;
let activeCat = null;
let showTrash = false;
let activeStatus = "";

const draftFollow = new Map();

/* 등록일 기준 6개월이 지난 자료 삭제 */
async function cleanupOldDocs() {
  const cutoffDate = new Date();
  cutoffDate.setMonth(
    cutoffDate.getMonth() - KEEP_MONTHS
  );

  const cutoff = cutoffDate.getTime();

  const oldQuery = query(
    collection(db, COL),
    where("createdAtMs", "<", cutoff)
  );

  const snapshot = await getDocs(oldQuery);

  if (snapshot.empty) return;

  const batch = writeBatch(db);

  snapshot.docs.forEach((item) => {
    batch.delete(item.ref);
  });

  await batch.commit();
}

async function addItem() {
  if (!ready) {
    alert(
      "서버 연결 중입니다. 잠시 후 다시 시도해 주세요."
    );
    return;
  }

  const name = ($("name")?.value || "").trim();
  const chart = ($("chart")?.value || "").trim();
  const examDate = $("examDate")?.value;
  const exams = getSelectedExams();
  const selectedCategory =
    getSelectedCategoryOrNull();

  if (
    !name ||
    !chart ||
    !examDate ||
    exams.length === 0
  ) {
    alert(
      "검사날짜/이름/차트번호/검사항목을 확인해 주세요."
    );
    return;
  }

  for (const exam of exams) {
    const duplicateQuery = query(
      collection(db, COL),
      where("examDate", "==", examDate),
      where("chart", "==", chart),
      where("exam", "==", exam),
      limit(1)
    );

    const snapshot = await getDocs(
      duplicateQuery
    );

    if (!snapshot.empty) {
      const confirmed = confirm(
        "선택한 항목 중 이미 등록된 검사가 포함되어 있습니다.\n그래도 등록할까요?"
      );

      if (!confirmed) return;
      break;
    }
  }

  for (const exam of exams) {
    const autoCategory =
      selectedCategory ||
      inferCategoryFromExam(exam);

    const payload = {
      name,
      chart,
      exam,
      examDate,
      status: "",
      visitAt: null,
      startAt: null,
      finishAt: null,
      followUp: "",
      deleted: false,
      deletedAt: null,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now()
    };

    if (autoCategory) {
      payload.category = autoCategory;
    }

    await addDoc(
      collection(db, COL),
      payload
    );
  }

  $("name").value = "";
  $("chart").value = "";

  document
    .querySelectorAll(".examChk")
    .forEach((item) => {
      item.checked = false;
    });

  document
    .querySelectorAll(
      'input[name="category"]'
    )
    .forEach((item) => {
      item.checked = false;
    });
}

function hasBlankSearchableField(it) {
  const fields = [
    getItemCategoryOrNull(it),
    it.status,
    it.followUp,
    normChart(it),
    normName(it),
    it.exam
  ];

  return fields.some(
    (value) =>
      String(value ?? "").trim() === ""
  );
}

function renderSummary(rowsForDateAll) {
  const box = $("summaryBox");

  if (!box) return;

  const normalRows = rowsForDateAll.filter(
    (item) => !item.deleted
  );

  const countFor = (categoryKey) => {
    const rows = normalRows.filter((item) => {
      if (!categoryKey) return true;

      return (
        getItemCategoryOrNull(item) ===
        categoryKey
      );
    });

    const total = rows.length;

    const waiting = rows.filter(
      (item) =>
        String(item.status || "") === "대기"
    ).length;

    return {
      total,
      waiting
    };
  };

  const allCount = countFor(null);
  const imageCount = countFor("영상");
  const echoCount = countFor("심장초음파");
  const ultrasoundCount = countFor("초음파");
  const checkupCount = countFor("검진");

  const trashCount = rowsForDateAll.filter(
    (item) => Boolean(item.deleted)
  ).length;

  const tabs = [
    {
      key: null,
      label: "전체",
      total: allCount.total,
      waiting: allCount.waiting
    },
    {
      key: "영상",
      label: "영상",
      total: imageCount.total,
      waiting: imageCount.waiting
    },
    {
      key: "심장초음파",
      label: "심장초음파",
      total: echoCount.total,
      waiting: echoCount.waiting
    },
    {
      key: "초음파",
      label: "초음파",
      total: ultrasoundCount.total,
      waiting: ultrasoundCount.waiting
    },
    {
      key: "검진",
      label: "검진",
      total: checkupCount.total,
      waiting: checkupCount.waiting
    },
    {
      key: "__TRASH__",
      label: "휴지통",
      total: trashCount,
      waiting: null
    }
  ];

  box.innerHTML = `
    <div class="tabBar">
      ${tabs
        .map((tab) => {
          const isTrash =
            tab.key === "__TRASH__";

          const isActive = isTrash
            ? showTrash
            : !showTrash &&
              activeCat === tab.key;

          const subHtml = isTrash
            ? `<span class="sub">총 ${tab.total}명</span>`
            : `<span class="sub">총 ${tab.total}명 · 대기 ${tab.waiting}명</span>`;

          return `
            <button
              class="tabBtn ${
                isActive ? "active" : ""
              }"
              data-cat="${tab.key ?? ""}"
            >
              ${tab.label}
              ${subHtml}
            </button>
          `;
        })
        .join("")}
    </div>
  `;

  box.onclick = (event) => {
    const button =
      event.target.closest(".tabBtn");

    if (!button) return;

    const category =
      button.dataset.cat || null;

    if (category === "__TRASH__") {
      showTrash = true;
      activeCat = null;
      render();
      return;
    }

    showTrash = false;

    activeCat =
      category === "" ? null : category;

    render();
  };
}

function getSearchText(item) {
  return `
    ${normName(item)}
    ${normChart(item)}
    ${item.exam || ""}
    ${item.examDate || ""}
    ${getItemCategoryOrNull(item) || ""}
    ${item.status || ""}
    ${item.followUp || ""}
  `.toLowerCase();
}

function render() {
  const queryRaw = $("q")?.value || "";
  const queryText =
    queryRaw.trim().toLowerCase();

  const blankSearch =
    queryRaw.length > 0 &&
    queryText === "";

  const selectedDate =
    $("examDate")?.value || todayStr();

  const list = $("list");
  list.innerHTML = "";

  const selectedDateRows = all.filter(
    (item) => item.examDate === selectedDate
  );

  renderSummary(selectedDateRows);

  /*
   * 검색어가 있으면 6개월 보관 자료 전체에서 검색합니다.
   * 검색어가 없으면 선택한 날짜 자료만 표시합니다.
   */
  const baseRows = queryText
    ? all
    : selectedDateRows;

  const visibleRows = baseRows.filter(
    (item) =>
      showTrash
        ? Boolean(item.deleted)
        : !item.deleted
  );

  const filtered = visibleRows
    .filter((item) => {
      if (showTrash) return true;
      if (!activeCat) return true;

      return (
        getItemCategoryOrNull(item) ===
        activeCat
      );
    })
    .filter((item) => {
      if (!activeStatus) return true;

      return (
        String(item.status || "") ===
        activeStatus
      );
    })
    .filter((item) => {
      if (blankSearch) {
        return hasBlankSearchableField(item);
      }

      if (!queryText) return true;

      return getSearchText(item).includes(
        queryText
      );
    });

  if (filtered.length === 0) {
    const row =
      document.createElement("tr");

    row.innerHTML = `
      <td colspan="7" class="muted">
        표시할 항목이 없습니다.
      </td>
    `;

    list.appendChild(row);
    return;
  }

  for (const item of filtered) {
    const followValue = draftFollow.has(
      item.id
    )
      ? draftFollow.get(item.id)
      : item.followUp || "";

    const safeFollow =
      escAttr(followValue);

    const safeName =
      escAttr(normName(item));

    const safeChart =
      escAttr(normChart(item));

    const safeCategory = escAttr(
      getItemCategoryOrNull(item) || ""
    );

    const stateUi = getStateUi(item);
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>
        ${
          showTrash
            ? safeCategory
            : `
              <select
                data-role="category"
                data-id="${item.id}"
              >
                ${categoryOptionsHtml(
                  getItemCategoryOrNull(item) ||
                    ""
                )}
              </select>
            `
        }
      </td>

      <td>
        <input
          data-role="chart"
          data-id="${item.id}"
          value="${safeChart}"
          title="검사일: ${
            item.examDate || ""
          }"
          ${showTrash ? "disabled" : ""}
        >
      </td>

      <td>
        <input
          data-role="name"
          data-id="${item.id}"
          value="${safeName}"
          title="검사일: ${
            item.examDate || ""
          }"
          ${showTrash ? "disabled" : ""}
        >
      </td>

      <td>
        ${
          showTrash
            ? item.exam || ""
            : `
              <select
                data-role="exam"
                data-id="${item.id}"
              >
                ${examOptionsHtml(item.exam)}
              </select>
            `
        }
      </td>

      <td>
        ${
          showTrash
            ? `
              <span style="font-weight:600;">
                ${stateUi.label}
              </span>
            `
            : `
              <div class="stateCell">
                <button
                  class="stateChip ${stateUi.className}"
                  data-act="${stateUi.nextAct}"
                  data-id="${item.id}"
                >
                  ${stateUi.label}
                </button>
              </div>
            `
        }
      </td>

      <td>
        <input
          data-role="followUp"
          data-id="${item.id}"
          value="${safeFollow}"
          ${showTrash ? "disabled" : ""}
        >
      </td>

      <td>
        ${
          showTrash
            ? `
              <button
                data-act="restore"
                data-id="${item.id}"
              >
                복구
              </button>

              <button
                data-act="purge"
                data-id="${item.id}"
              >
                삭제
              </button>
            `
            : `
              <div class="manageBtns">
                <button
                  data-act="trash"
                  data-id="${item.id}"
                >
                  삭제
                </button>
              </div>
            `
        }
      </td>
    `;

    list.appendChild(row);
  }
}

async function moveToTrash(id) {
  await updateDoc(doc(db, COL, id), {
    deleted: true,
    deletedAt: serverTimestamp()
  });
}

async function restoreFromTrash(id) {
  await updateDoc(doc(db, COL, id), {
    deleted: false,
    deletedAt: null
  });
}

async function purgeForever(id) {
  await deleteDoc(doc(db, COL, id));
}

function getFilteredRowsForExport() {
  const queryRaw = $("q")?.value || "";
  const queryText =
    queryRaw.trim().toLowerCase();

  const blankSearch =
    queryRaw.length > 0 &&
    queryText === "";

  const selectedDate =
    $("examDate")?.value || todayStr();

  const selectedDateRows = all.filter(
    (item) => item.examDate === selectedDate
  );

  const baseRows = queryText
    ? all
    : selectedDateRows;

  return baseRows
    .filter((item) =>
      showTrash
        ? Boolean(item.deleted)
        : !item.deleted
    )
    .filter((item) => {
      if (showTrash) return true;
      if (!activeCat) return true;

      return (
        getItemCategoryOrNull(item) ===
        activeCat
      );
    })
    .filter((item) => {
      if (!activeStatus) return true;

      return (
        String(item.status || "") ===
        activeStatus
      );
    })
    .filter((item) => {
      if (blankSearch) {
        return hasBlankSearchableField(item);
      }

      if (!queryText) return true;

      return getSearchText(item).includes(
        queryText
      );
    });
}

function exportXlsx() {
  const XLSX = window.XLSX;

  if (!XLSX) {
    alert(
      "엑셀 저장 모듈을 불러오지 못했습니다.\n인터넷 연결 또는 로딩 순서를 확인해 주세요."
    );
    return;
  }

  const rows = getFilteredRowsForExport();

  if (!rows.length) {
    alert("저장할 데이터가 없습니다.");
    return;
  }

  const selectedDate =
    $("examDate")?.value || todayStr();

  const tabName = showTrash
    ? "휴지통"
    : activeCat || "전체";

  const statusName = activeStatus
    ? activeStatus
    : "상태전체";

  const data = [
    [
      "차트번호",
      "이름",
      "검사날짜",
      "검사항목",
      "추적검사시기"
    ]
  ];

  for (const item of rows) {
    data.push([
      normChart(item),
      normName(item),
      item.examDate || "",
      item.exam || "",
      item.followUp || ""
    ]);
  }

  const worksheet =
    XLSX.utils.aoa_to_sheet(data);

  const workbook =
    XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "Worklist"
  );

  const fileName =
    `속안심_Worklist_${selectedDate}_${tabName}_${statusName}.xlsx`;

  XLSX.writeFile(workbook, fileName);
}

function wireEvents() {
  $("btnAdd")?.addEventListener(
    "click",
    addItem
  );

  $("btnSearch")?.addEventListener(
    "click",
    render
  );

  $("btnReset")?.addEventListener(
    "click",
    () => {
      $("q").value = "";
      render();
    }
  );

  $("examDate")?.addEventListener(
    "change",
    render
  );

  $("statusFilterTh")?.addEventListener(
    "change",
    () => {
      activeStatus =
        $("statusFilterTh").value || "";

      render();
    }
  );

  $("btnExportXlsx")?.addEventListener(
    "click",
    exportXlsx
  );

  $("list")?.addEventListener(
    "change",
    async (event) => {
      const categorySelect =
        event.target.closest(
          'select[data-role="category"]'
        );

      if (categorySelect) {
        if (showTrash) return;

        const id =
          categorySelect.dataset.id;

        const value = String(
          categorySelect.value || ""
        ).trim();

        try {
          await updateDoc(
            doc(db, COL, id),
            {
              category: value || null
            }
          );
        } catch (error) {
          console.error(error);
          alert("분류 저장에 실패했습니다.");
        }

        return;
      }

      const examSelect =
        event.target.closest(
          'select[data-role="exam"]'
        );

      if (examSelect) {
        if (showTrash) return;

        const id =
          examSelect.dataset.id;

        const value = String(
          examSelect.value || ""
        ).trim();

        const autoCategory =
          inferCategoryFromExam(value);

        try {
          const payload = {
            exam: value
          };

          if (autoCategory) {
            payload.category = autoCategory;
          }

          await updateDoc(
            doc(db, COL, id),
            payload
          );
        } catch (error) {
          console.error(error);

          alert(
            "검사항목 저장에 실패했습니다."
          );
        }
      }
    }
  );

  $("list")?.addEventListener(
    "input",
    (event) => {
      const followInput =
        event.target.closest(
          'input[data-role="followUp"]'
        );

      if (followInput) {
        draftFollow.set(
          followInput.dataset.id,
          followInput.value
        );
      }
    }
  );

  $("list")?.addEventListener(
    "click",
    async (event) => {
      const button =
        event.target.closest("button");

      if (!button) return;

      const action = button.dataset.act;
      const id = button.dataset.id;

      if (!action || !id) return;

      const item = all.find(
        (row) => row.id === id
      );

      if (!item) return;

      if (action === "trash") {
        const confirmed = confirm(
          "휴지통으로 이동할까요?"
        );

        if (!confirmed) return;

        await moveToTrash(id);
        return;
      }

      if (action === "restore") {
        await restoreFromTrash(id);
        return;
      }

      if (action === "purge") {
        const confirmed = confirm(
          "영구삭제할까요? (복구 불가)"
        );

        if (!confirmed) return;

        await purgeForever(id);
        return;
      }

      if (showTrash) return;

      if (action === "next") {
        if (!item.status) {
          await updateDoc(
            doc(db, COL, id),
            {
              status: "대기",
              visitAt: serverTimestamp()
            }
          );

          return;
        }

        if (item.status === "대기") {
          await updateDoc(
            doc(db, COL, id),
            {
              status: "진행중",
              startAt: serverTimestamp()
            }
          );

          return;
        }

        if (item.status === "진행중") {
          await updateDoc(
            doc(db, COL, id),
            {
              status: "완료",
              finishAt: serverTimestamp()
            }
          );

          return;
        }

        if (item.status === "완료") {
          await updateDoc(
            doc(db, COL, id),
            {
              status: "",
              visitAt: null,
              startAt: null,
              finishAt: null
            }
          );
        }
      }
    }
  );

  $("list")?.addEventListener(
    "keydown",
    (event) => {
      const input = event.target.closest(
        'input[data-role="followUp"], input[data-role="name"], input[data-role="chart"]'
      );

      if (!input) return;
      if (event.key !== "Enter") return;

      event.preventDefault();
      input.blur();
    }
  );

  $("list")?.addEventListener(
    "focusout",
    async (event) => {
      if (showTrash) return;

      const chartInput =
        event.target.closest(
          'input[data-role="chart"]'
        );

      if (chartInput) {
        const id =
          chartInput.dataset.id;

        const item = all.find(
          (row) => row.id === id
        );

        if (!item) return;

        const value = String(
          chartInput.value ?? ""
        ).trim();

        if (!value) {
          alert(
            "차트번호는 빈값으로 저장할 수 없습니다."
          );

          chartInput.value =
            normChart(item);

          return;
        }

        if (
          value !==
          String(item.chart || "").trim()
        ) {
          try {
            await updateDoc(
              doc(db, COL, id),
              {
                chart: value
              }
            );
          } catch (error) {
            console.error(error);

            alert(
              "차트번호 저장에 실패했습니다."
            );
          }
        }

        return;
      }

      const nameInput =
        event.target.closest(
          'input[data-role="name"]'
        );

      if (nameInput) {
        const id =
          nameInput.dataset.id;

        const item = all.find(
          (row) => row.id === id
        );

        if (!item) return;

        const value = String(
          nameInput.value ?? ""
        ).trim();

        if (!value) {
          alert(
            "이름은 빈값으로 저장할 수 없습니다."
          );

          nameInput.value =
            normName(item);

          return;
        }

        if (
          value !==
          String(item.name || "").trim()
        ) {
          try {
            await updateDoc(
              doc(db, COL, id),
              {
                name: value
              }
            );
          } catch (error) {
            console.error(error);

            alert(
              "이름 저장에 실패했습니다."
            );
          }
        }

        return;
      }

      const followInput =
        event.target.closest(
          'input[data-role="followUp"]'
        );

      if (followInput) {
        const id =
          followInput.dataset.id;

        const value = String(
          followInput.value ?? ""
        ).trim();

        try {
          await updateDoc(
            doc(db, COL, id),
            {
              followUp: value
            }
          );

          draftFollow.delete(id);
        } catch (error) {
          console.error(error);

          alert(
            "추적검사시기 저장에 실패했습니다."
          );
        }
      }
    }
  );
}

$("examDate").value = todayStr();

wireEvents();

onAuthStateChanged(
  auth,
  async (user) => {
    if (!user) return;

    ready = true;

    try {
      await cleanupOldDocs();
    } catch (error) {
      console.error(
        "cleanup failed:",
        error
      );
    }

    const worklistQuery = query(
      collection(db, COL),
      orderBy("createdAtMs", "desc")
    );

    onSnapshot(
      worklistQuery,
      (snapshot) => {
        all = snapshot.docs.map(
          (item) => ({
            id: item.id,
            ...item.data()
          })
        );

        render();
      }
    );
  }
);

signInAnonymously(auth);