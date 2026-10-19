// 화면 코드(JavaScript)에서 오류가 나면 조용히 멈추지 않고 화면 아래 알림으로 알려준다.
// 창 안에서는 개발자 도구를 열기 어려워서, 무슨 일이 생겼는지 바로 보이게 하려는 것이다
window.addEventListener("error", function (e) {
    showToast("화면 오류: " + e.message);
});
// await 하다가 실패했는데 아무도 잡지 않은 오류도 같은 방식으로 알려준다
window.addEventListener("unhandledrejection", function (e) {
    showToast("화면 오류: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

// 탭 버튼 4개와 탭 내용 4개를 모두 찾아서 변수에 담는다
const tabButtons = document.querySelectorAll(".tab-button");
const tabContents = document.querySelectorAll(".tab-content");

// 버튼을 하나씩 꺼내서, 각각 "클릭되면 할 일"을 등록한다
tabButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        // 1. 모든 버튼과 내용에서 active를 뗀다
        tabButtons.forEach(function (b) {
            b.classList.remove("active");
        });
        tabContents.forEach(function (c) {
            c.classList.remove("active");
        });

        // 2. 클릭된 버튼에 active를 붙인다
        button.classList.add("active");

        // 3. 클릭된 버튼의 data-tab 값(예: "today")과 같은 id를 가진 내용에도 active를 붙인다
        const tabName = button.dataset.tab;
        document.getElementById(tabName).classList.add("active");

        // 4. 캘린더 탭으로 돌아왔을 때 달력 크기를 다시 계산시킨다.
        //    (숨겨져 있는 동안은 크기를 잴 수 없어서 달력이 찌그러질 수 있다)
        if (tabName === "calendar") {
            calendar.updateSize();
        }

        // 5. 오늘 탭을 열 때마다 일정과 할 일을 새로 불러온다. (날짜가 바뀌었거나, 폰에서 일정을 바꿨을 수 있다)
        if (tabName === "today") {
            loadToday();
        }
    });
});

// ---------- 캘린더 탭 ----------

// 체크를 꺼서 "숨기기로 한" 캘린더의 id를 모아두는 곳.
// Set은 중복 없이 값을 담는 상자다 (파이썬의 set과 같다)
const hiddenCalendarIds = new Set();

// 달력이 그려질 빈 칸(index.html의 id="calendar-view")을 찾는다
const calendarElement = document.getElementById("calendar-view");

// FullCalendar 달력 객체를 만든다. 두 번째 칸에 설정을 적는다
const calendar = new FullCalendar.Calendar(calendarElement, {
    // 처음 열면 월간 보기
    initialView: "dayGridMonth",

    // 달력 맨 위 줄: 왼쪽(이전/다음/오늘), 가운데(제목), 오른쪽(월/주/일 전환)
    headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay",
    },

    // 한국어로 표시한다 (요일이 일, 월, 화... 로 나온다)
    locale: "ko",

    // 버튼 글자 중 일부는 한국어 기본값 대신 직접 정한다
    buttonText: { today: "오늘", month: "월간", week: "주간", day: "일간" },

    // 일정 앞에 붙는 시간 표기: 24시간제, 두 자리 맞춤 (예: 07:45, 19:45)
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },

    // 주간/일간 보기 왼쪽의 시간 눈금도 같은 형식으로 맞춘다
    slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },

    // 달력 높이: 창 높이에서 위쪽 탭 영역만큼 뺀 만큼 쓴다
    height: "calc(100vh - 110px)",

    // 일정을 드래그로 옮기거나 끝을 늘리는 걸 허용한다. (쓸 수 없는 캘린더의 일정은 서버가 editable: false로 막아준다)
    editable: true,

    // 아래 네 개는 "사용자가 이런 동작을 했을 때 실행할 함수"를 FullCalendar에 등록하는 것이다.
    // 함수의 실제 내용은 이 파일 아래쪽에 있다
    dateClick: openAddDialog,        // 빈 날짜/시간 칸을 클릭
    eventClick: openEditDialog,      // 일정을 클릭
    eventDrop: saveEventTime,        // 일정을 다른 날짜/시간으로 드래그
    eventResize: saveEventTime,      // 일정의 끝을 잡아 길이를 바꿈

    // 마우스가 일정 위에 올라가면 그 일정을 기억하고, 벗어나면 잊는다. Ctrl+C가 "어떤 일정을 복사할지" 알기 위해서다
    eventMouseEnter: function (info) {
        hoveredEvent = info.event;
    },
    eventMouseLeave: function () {
        hoveredEvent = null;
    },

    // 일정이 필요할 때마다 FullCalendar가 이 함수를 불러준다.
    // info: 지금 화면에 보이는 기간 정보, successCallback: 일정을 넘겨줄 때 부르는 함수
    events: async function (info, successCallback, failureCallback) {
        try {
            // Flask의 /api/events에 "이 기간의 일정 주세요" 하고 요청한다
            const response = await fetch(
                "/api/events?start=" + encodeURIComponent(info.startStr) +
                "&end=" + encodeURIComponent(info.endStr)
            );
            // 서버가 오류를 돌려줬다면(예: 인터넷 끊김) 오류로 취급한다
            if (!response.ok) {
                throw new Error("서버 오류: " + response.status);
            }
            // 받은 JSON 글자를 자바스크립트 리스트로 바꾼다
            const events = await response.json();

            // 이미 체크를 꺼둔 캘린더의 일정은, 달을 넘겨서 새로 불러올 때도 숨긴 채로 시작해야 한다.
            // display: "none"을 붙이면 FullCalendar가 그 일정을 그리지 않는다
            events.forEach(function (event) {
                if (hiddenCalendarIds.has(event.calendarId)) {
                    event.display = "none";
                }
            });

            // FullCalendar에게 일정을 넘겨주면 달력에 표시된다
            successCallback(events);
        } catch (error) {
            // 실패하면 콘솔에 이유를 남기고, 화면에는 알려준다
            console.error("일정을 불러오지 못했습니다:", error);
            failureCallback(error);
        }
    },
});

// 준비한 달력을 실제로 화면에 그린다
calendar.render();

// ---------- 일정 추가 / 수정 / 삭제 / 드래그 ----------

// index.html의 입력 창과 그 안의 칸들을 찾아둔다
const eventDialog = document.getElementById("event-dialog");
const eventDialogTitle = document.getElementById("event-dialog-title");
const eventTitleInput = document.getElementById("event-title");
const eventCalendarSelect = document.getElementById("event-calendar");
const eventAllDayCheckbox = document.getElementById("event-all-day");
const eventStartDate = document.getElementById("event-start-date");
const eventStartTime = document.getElementById("event-start-time");
const eventEndDate = document.getElementById("event-end-date");
const eventEndTime = document.getElementById("event-end-time");
const eventError = document.getElementById("event-error");
const eventDeleteButton = document.getElementById("event-delete");
const eventCancelButton = document.getElementById("event-cancel");
const eventSaveButton = document.getElementById("event-save");
const toastElement = document.getElementById("toast");

// 지금 마우스가 올라가 있는 일정과 날짜 칸("2026-10-18" 형식). 복사/붙여넣기에 쓴다
let hoveredEvent = null;
let hoveredDate = null;
// Ctrl+C로 복사해둔 일정 정보. null이면 복사한 게 없다
let copiedEvent = null;
// 붙여넣는 요청이 진행 중인지 (Ctrl+V를 연타해도 중복으로 만들어지지 않게 한다)
let pasting = false;

// 지금 수정 중인 일정. null이면 "새 일정 추가" 모드다
let editingEvent = null;
// 삭제 버튼을 한 번 눌러서 "정말 삭제?" 확인을 기다리는 중인지
let deleteArmed = false;
// 새 일정을 추가할 때 미리 선택해둘 캘린더의 id. loadCalendarList가 정한다
let defaultCalendarId = null;

// 숫자를 두 자리 글자로 만든다 (5 → "05")
function pad(number) {
    return String(number).padStart(2, "0");
}

// 자바스크립트 Date → "2026-10-18" (이 컴퓨터의 시간대 기준)
function toDateText(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
}

// 자바스크립트 Date → "14:30"
function toTimeText(date) {
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

// Date의 날짜를 days만큼 더한 새 Date (시각은 0시로)
function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// "2026-10-18"에 days일을 더한 글자 ("2026-10-19")
function addDaysToText(text, days) {
    const [year, month, day] = text.split("-").map(Number);
    return toDateText(new Date(year, month - 1, day + days));
}

// 화면 아래에 알림을 4초 동안 띄운다
let toastTimer = null;
function showToast(message) {
    toastElement.textContent = message;
    toastElement.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        toastElement.classList.remove("show");
    }, 4000);
}

// 서버에 JSON 요청을 보낸다. 실패하면 서버가 알려준 이유를 담은 Error를 던진다.
// method: "POST"(만들기), "PATCH"(일부 고치기), "DELETE"(지우기)
async function sendRequest(url, method, body) {
    const response = await fetch(url, {
        method: method,
        // 보내는 내용이 JSON이라고 서버에 알려준다
        headers: { "Content-Type": "application/json" },
        // body가 있을 때만 JSON 글자로 바꿔서 붙인다
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        let message = "서버 오류: " + response.status;
        try {
            const data = await response.json();
            if (data.error) {
                message = data.error;
            }
        } catch (error) {
            // 서버 응답이 JSON이 아니면 위의 기본 메시지를 쓴다
        }
        throw new Error(message);
    }
}

// 종일이면 시간 칸을 숨긴다
function updateTimeInputs() {
    eventStartTime.hidden = eventAllDayCheckbox.checked;
    eventEndTime.hidden = eventAllDayCheckbox.checked;
}
eventAllDayCheckbox.addEventListener("change", updateTimeInputs);

// 입력 창을 열고 칸들을 채운다. 추가/수정이 같이 쓴다
function showEventDialog(values) {
    editingEvent = values.event || null;
    deleteArmed = false;
    eventDeleteButton.textContent = "삭제";
    eventDeleteButton.hidden = !editingEvent;  // 수정할 때만 삭제 버튼을 보인다
    eventDialogTitle.textContent = editingEvent ? "일정 수정" : "일정 추가";

    eventTitleInput.value = values.title;
    eventAllDayCheckbox.checked = values.allDay;
    eventStartDate.value = values.startDate;
    eventStartTime.value = values.startTime;
    eventEndDate.value = values.endDate;
    eventEndTime.value = values.endTime;
    // 수정할 때는 일정이 속한 캘린더로 고정하고 바꾸지 못하게 한다.
    // 새 일정은 기본 캘린더가 미리 선택되고, 직접 바꿀 수 있다
    eventCalendarSelect.value = values.calendarId || defaultCalendarId;
    eventCalendarSelect.disabled = !!editingEvent;
    eventError.textContent = "";
    updateTimeInputs();

    eventDialog.showModal();  // 창을 화면 위에 띄운다
    eventTitleInput.focus();
}

// 빈 날짜/시간 칸을 클릭했을 때: 새 일정 추가 창을 연다. info.date는 클릭한 칸의 시각이다
function openAddDialog(info) {
    const date = info.date;
    let allDay = false;
    let start;
    if (info.view.type === "dayGridMonth") {
        // 월간 보기: 클릭한 날의 09:00~10:00를 기본값으로 한다
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
    } else if (info.allDay) {
        // 주간/일간 보기 위쪽의 "종일" 줄을 클릭
        allDay = true;
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
    } else {
        // 주간/일간 보기의 시간 칸: 클릭한 시각부터 1시간
        start = date;
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);  // 시작 + 1시간

    showEventDialog({
        title: "",
        allDay: allDay,
        startDate: toDateText(start),
        startTime: toTimeText(start),
        endDate: toDateText(end),
        endTime: toTimeText(end),
    });
}

// 일정을 클릭했을 때: 그 일정의 값으로 채운 수정 창을 연다
function openEditDialog(info) {
    const event = info.event;
    // 공휴일 캘린더처럼 쓸 수 없는 캘린더의 일정은 수정 창을 열지 않는다
    if (!event.extendedProps.canEdit) {
        showToast("이 캘린더의 일정은 수정할 수 없습니다.");
        return;
    }

    let endDate;
    let endTime;
    if (event.allDay) {
        // 종일 일정의 end는 "포함하지 않는 날짜"다. 화면에는 마지막 날을 보여주려고 하루를 뺀다
        endDate = event.end ? toDateText(addDays(event.end, -1)) : toDateText(event.start);
        endTime = "10:00";
    } else {
        const end = event.end || new Date(event.start.getTime() + 60 * 60 * 1000);
        endDate = toDateText(end);
        endTime = toTimeText(end);
    }

    showEventDialog({
        event: event,
        title: event.title,
        calendarId: event.extendedProps.calendarId,
        allDay: event.allDay,
        startDate: toDateText(event.start),
        startTime: event.allDay ? "09:00" : toTimeText(event.start),
        endDate: endDate,
        endTime: endTime,
    });
}

// 입력 창의 칸들을 읽어서 서버에 보낼 {allDay, start, end}로 만든다. 잘못됐으면 Error를 던진다
function readTimeFields() {
    const startDate = eventStartDate.value;
    const endDate = eventEndDate.value;
    if (!startDate || !endDate) {
        throw new Error("날짜를 입력하세요.");
    }

    if (eventAllDayCheckbox.checked) {
        if (endDate < startDate) {
            throw new Error("끝 날짜가 시작 날짜보다 빠릅니다.");
        }
        // 화면의 끝 날짜는 마지막 날이고, Google은 "포함하지 않는 날짜"를 원하므로 하루를 더한다
        return { allDay: true, start: startDate, end: addDaysToText(endDate, 1) };
    }

    if (!eventStartTime.value || !eventEndTime.value) {
        throw new Error("시간을 입력하세요.");
    }
    const start = startDate + "T" + eventStartTime.value;
    const end = endDate + "T" + eventEndTime.value;
    // 같은 형식의 글자끼리는 글자 순서가 곧 시간 순서라서 그대로 비교할 수 있다
    if (end <= start) {
        throw new Error("끝 시간이 시작 시간보다 늦어야 합니다.");
    }
    return { allDay: false, start: start, end: end };
}

// 저장/삭제 중에는 버튼을 눌러도 반응하지 않게 해서 중복 요청을 막는다
function setDialogBusy(busy) {
    eventSaveButton.disabled = busy;
    eventDeleteButton.disabled = busy;
    eventCancelButton.disabled = busy;
}

// 저장 버튼: 추가면 POST, 수정이면 PATCH를 보낸다
async function saveEvent() {
    const title = eventTitleInput.value.trim();
    if (!title) {
        eventError.textContent = "제목을 입력하세요.";
        return;
    }

    try {
        const timeFields = readTimeFields();
        setDialogBusy(true);
        eventError.textContent = "저장하는 중...";

        if (editingEvent) {
            await sendRequest("/api/events/" + encodeURIComponent(editingEvent.id), "PATCH", {
                calendarId: editingEvent.extendedProps.calendarId,
                title: title,
                ...timeFields,
            });
        } else {
            await sendRequest("/api/events", "POST", {
                calendarId: eventCalendarSelect.value,
                title: title,
                ...timeFields,
            });
        }

        eventDialog.close();
        calendar.refetchEvents();  // Google에서 일정을 다시 불러와서 화면을 맞춘다
    } catch (error) {
        // 실패하면 창을 닫지 않고 이유를 보여준다. 입력한 내용이 남아 있어서 다시 시도할 수 있다
        eventError.textContent = error.message;
    } finally {
        setDialogBusy(false);
    }
}

// 삭제 버튼: 실수를 막기 위해 두 번 눌러야 지워진다
async function deleteEvent() {
    if (!deleteArmed) {
        deleteArmed = true;
        eventDeleteButton.textContent = "정말 삭제? (한 번 더)";
        return;
    }

    try {
        setDialogBusy(true);
        eventError.textContent = "삭제하는 중...";
        await sendRequest(
            "/api/events/" + encodeURIComponent(editingEvent.id) +
            "?calendarId=" + encodeURIComponent(editingEvent.extendedProps.calendarId),
            "DELETE"
        );
        eventDialog.close();
        calendar.refetchEvents();
    } catch (error) {
        eventError.textContent = error.message;
    } finally {
        setDialogBusy(false);
    }
}

eventSaveButton.addEventListener("click", saveEvent);
eventDeleteButton.addEventListener("click", deleteEvent);
eventCancelButton.addEventListener("click", function () {
    eventDialog.close();
});
// 제목 칸에서 Enter를 누르면 저장한다
eventTitleInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        saveEvent();
    }
});

// 일정을 드래그로 옮기거나 끝을 늘렸을 때: 바뀐 시간을 Google에 PATCH로 보낸다.
// FullCalendar는 이미 화면에서 일정을 옮겨둔 상태이므로, 실패하면 info.revert()로 되돌린다
async function saveEventTime(info) {
    const event = info.event;
    let timeFields;
    if (event.allDay) {
        const start = toDateText(event.start);
        // 끝이 없는 종일 일정은 하루짜리다
        const end = event.end ? toDateText(event.end) : addDaysToText(start, 1);
        timeFields = { allDay: true, start: start, end: end };
    } else {
        // 종일 일정을 시간 칸으로 끌어왔을 때처럼 끝이 없으면 1시간짜리로 만든다
        const end = event.end || new Date(event.start.getTime() + 60 * 60 * 1000);
        timeFields = {
            allDay: false,
            start: toDateText(event.start) + "T" + toTimeText(event.start),
            end: toDateText(end) + "T" + toTimeText(end),
        };
    }

    try {
        await sendRequest("/api/events/" + encodeURIComponent(event.id), "PATCH", {
            calendarId: event.extendedProps.calendarId,
            ...timeFields,
        });
    } catch (error) {
        info.revert();  // 일정을 원래 자리로 돌려놓는다
        showToast("일정을 옮기지 못했습니다: " + error.message);
    }
}

// ---------- 일정 복사 / 붙여넣기 ----------

// 마우스가 움직일 때마다, 지금 마우스 아래에 있는 날짜 칸이 어디인지 기억해둔다.
// FullCalendar는 날짜 칸마다 data-date="2026-10-18" 속성을 붙여두므로, 마우스 아래 요소에서
// 가장 가까운 data-date 달린 요소(closest)를 찾으면 된다. 월간/주간/일간 보기 모두 같은 방식이다
document.addEventListener("mouseover", function (e) {
    const cell = e.target.closest("[data-date]");
    hoveredDate = cell ? cell.dataset.date : null;
});

// Ctrl+C: 마우스가 올라가 있는 일정의 내용(제목, 시각, 길이)을 기억해둔다
function copyHoveredEvent() {
    if (!hoveredEvent) {
        return;
    }
    const event = hoveredEvent;

    // 길이를 저장해둔다. 종일 일정은 "며칠", 시간 있는 일정은 "몇 밀리초"
    let days = 1;
    let durationMs = 60 * 60 * 1000;
    if (event.allDay) {
        if (event.end) {
            // 하루는 24시간 = 86400000밀리초. Math.round는 반올림이다
            days = Math.round((event.end - event.start) / 86400000);
        }
    } else if (event.end) {
        durationMs = event.end - event.start;
    }

    copiedEvent = {
        title: event.title,
        // 쓸 수 없는 캘린더(공휴일 등)의 일정이면 null로 두고, 붙여넣을 때 기본 캘린더를 쓴다
        calendarId: event.extendedProps.canEdit ? event.extendedProps.calendarId : null,
        allDay: event.allDay,
        startTime: event.allDay ? null : toTimeText(event.start),
        days: days,
        durationMs: durationMs,
    };
    showToast("복사했습니다: " + event.title);
}

// Ctrl+V: 마우스가 올라가 있는 날짜 칸에, 복사해둔 일정을 새로 만든다
async function pasteCopiedEvent() {
    if (!copiedEvent) {
        showToast("복사한 일정이 없습니다. 일정 위에 마우스를 올리고 Ctrl+C를 눌러주세요.");
        return;
    }
    if (!hoveredDate) {
        showToast("붙여넣을 날짜 칸 위에 마우스를 올려주세요.");
        return;
    }
    if (pasting) {
        return;
    }

    // 붙여넣을 날짜 칸에 맞춰 시작/끝을 계산한다
    let start;
    let end;
    if (copiedEvent.allDay) {
        start = hoveredDate;
        end = addDaysToText(hoveredDate, copiedEvent.days);  // 끝은 "포함하지 않는 날짜"
    } else {
        // 날짜만 바뀌고, 시작 시각과 길이는 원래 그대로다
        const [year, month, day] = hoveredDate.split("-").map(Number);
        const [hour, minute] = copiedEvent.startTime.split(":").map(Number);
        const startDate = new Date(year, month - 1, day, hour, minute);
        const endDate = new Date(startDate.getTime() + copiedEvent.durationMs);
        start = toDateText(startDate) + "T" + toTimeText(startDate);
        end = toDateText(endDate) + "T" + toTimeText(endDate);
    }

    pasting = true;
    try {
        await sendRequest("/api/events", "POST", {
            calendarId: copiedEvent.calendarId || defaultCalendarId,
            title: copiedEvent.title,
            allDay: copiedEvent.allDay,
            start: start,
            end: end,
        });
        calendar.refetchEvents();
        showToast("붙여넣었습니다: " + copiedEvent.title);
    } catch (error) {
        showToast("붙여넣지 못했습니다: " + error.message);
    } finally {
        pasting = false;
    }
}

// 키보드를 눌렀을 때: Ctrl+C / Ctrl+V면 위의 복사/붙여넣기를 실행한다
document.addEventListener("keydown", function (e) {
    // 입력 창이 열려 있거나 글자 입력 칸에 커서가 있으면, 그 칸의 평소 복사/붙여넣기가 우선이다
    if (eventDialog.open || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) {
        return;
    }
    // 캘린더 탭이 아닌 곳에서는 동작하지 않는다
    if (!document.getElementById("calendar").classList.contains("active")) {
        return;
    }

    if (e.ctrlKey && e.key.toLowerCase() === "c") {
        copyHoveredEvent();
    } else if (e.ctrlKey && e.key.toLowerCase() === "v") {
        pasteCopiedEvent();
    }
});

// ---------- 오늘 탭 ----------

const todayTitle = document.getElementById("today-title");
const todayEventsList = document.getElementById("today-events");
const todayTasksList = document.getElementById("today-tasks");
const overdueSection = document.getElementById("overdue-section");
const overdueTasksList = document.getElementById("overdue-tasks");
const taskInput = document.getElementById("task-input");
const taskAddButton = document.getElementById("task-add-button");

// 오늘 탭이 보여주는 날짜("2026-10-19"). 탭을 열 때마다 새로 구한다. 켜둔 채 자정을 넘길 수도 있기 때문이다
let todayText = toDateText(new Date());

// 목록(<ul>)에 "내용이 없을 때" 보여줄 회색 안내 문장 한 줄을 넣는다
function showEmptyMessage(listElement, message) {
    const item = document.createElement("li");
    item.className = "today-empty";
    item.textContent = message;
    listElement.appendChild(item);
}

// 오늘의 일정을 서버에서 받아와서 왼쪽 목록에 그린다
async function loadTodayEvents() {
    // 캘린더 탭이 쓰는 /api/events를 그대로 쓴다. 오늘 0시 ~ 내일 0시를 요청한다
    const response = await fetch(
        "/api/events?start=" + todayText + "&end=" + addDaysToText(todayText, 1)
    );
    if (!response.ok) {
        throw new Error("서버 오류: " + response.status);
    }
    const events = await response.json();

    // 캘린더 탭에서 체크를 꺼둔 캘린더의 일정은 여기서도 보이지 않게 한다
    const visible = events.filter(function (event) {
        return !hiddenCalendarIds.has(event.calendarId);
    });

    // 정렬: 종일 일정이 맨 위, 그 아래는 시작 시각 순서.
    // 종일 일정의 start는 "2026-10-19"(10글자), 시간 있는 일정은 "2026-10-19T09:00:00+09:00"처럼 더 길다
    visible.sort(function (a, b) {
        const aAllDay = a.start.length === 10;
        const bAllDay = b.start.length === 10;
        if (aAllDay !== bAllDay) {
            return aAllDay ? -1 : 1;
        }
        // Date끼리 빼면 밀리초 차이가 나오므로, 빠른 일정이 앞에 온다
        return new Date(a.start) - new Date(b.start);
    });

    todayEventsList.innerHTML = "";
    if (visible.length === 0) {
        showEmptyMessage(todayEventsList, "오늘 일정이 없습니다.");
        return;
    }

    visible.forEach(function (event) {
        const item = document.createElement("li");
        item.className = "today-event";

        // 캘린더 색 동그라미
        const dot = document.createElement("span");
        dot.className = "event-dot";
        dot.style.backgroundColor = event.color;

        // 시간 글자: 종일이면 "종일", 아니면 "09:00–10:00"
        const time = document.createElement("span");
        time.className = "event-time";
        if (event.start.length === 10) {
            time.textContent = "종일";
        } else {
            time.textContent = toTimeText(new Date(event.start)) + "–" + toTimeText(new Date(event.end));
        }

        const title = document.createElement("span");
        title.textContent = event.title;  // textContent: 제목에 < > 같은 글자가 있어도 HTML로 해석되지 않는다

        item.append(dot, time, title);
        todayEventsList.appendChild(item);
    });
}

// 할 일 한 줄(<li>)을 만든다.
// moveLabel/moveDate: "내일로" 버튼의 글자와, 누르면 옮겨 갈 날짜. showDate: 줄에 날짜를 같이 보일지(밀린 할 일)
function makeTaskRow(task, moveLabel, moveDate, showDate) {
    const item = document.createElement("li");
    item.className = "task-row";

    // 완료 체크박스. 체크하면 서버에 done을 저장하고 목록을 다시 불러온다 (끝낸 것은 아래로 내려간다)
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done === 1;
    checkbox.addEventListener("change", function () {
        updateTask(task.id, { done: checkbox.checked });
    });

    const content = document.createElement("span");
    content.className = "task-content" + (task.done === 1 ? " done" : "");
    content.textContent = task.content;

    item.append(checkbox, content);

    if (showDate) {
        const date = document.createElement("span");
        date.className = "task-date";
        date.textContent = task.date.slice(5).replace("-", "/");  // "2026-10-17" → "10/17"
        item.appendChild(date);
    }

    // 끝낸 할 일은 옮길 필요가 없으므로 버튼을 만들지 않는다
    if (task.done !== 1) {
        const moveButton = document.createElement("button");
        moveButton.textContent = moveLabel;
        moveButton.addEventListener("click", function () {
            updateTask(task.id, { date: moveDate });
        });
        item.appendChild(moveButton);
    }

    // 삭제 버튼: 일정 삭제와 같이 두 번 눌러야 지워진다. 한 번 누르고 3초 동안 안 누르면 원래대로 돌아간다
    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.textContent = "삭제";
    let armed = false;
    let armTimer = null;
    deleteButton.addEventListener("click", async function () {
        if (!armed) {
            armed = true;
            deleteButton.textContent = "정말?";
            armTimer = setTimeout(function () {
                armed = false;
                deleteButton.textContent = "삭제";
            }, 3000);
            return;
        }
        clearTimeout(armTimer);
        try {
            await sendRequest("/api/tasks/" + task.id, "DELETE");
            await loadTodayTasks();
        } catch (error) {
            showToast("할 일을 지우지 못했습니다: " + error.message);
        }
    });
    item.appendChild(deleteButton);

    return item;
}

// 서버에서 할 일 목록을 받아와서 오른쪽에 그린다
async function loadTodayTasks() {
    const response = await fetch("/api/tasks?date=" + todayText);
    if (!response.ok) {
        throw new Error("서버 오류: " + response.status);
    }
    const data = await response.json();

    // 오늘 할 일: "내일로" 버튼은 날짜를 내일로 바꾼다
    todayTasksList.innerHTML = "";
    if (data.tasks.length === 0) {
        showEmptyMessage(todayTasksList, "오늘 할 일이 없습니다.");
    }
    data.tasks.forEach(function (task) {
        todayTasksList.appendChild(makeTaskRow(task, "내일로", addDaysToText(todayText, 1), false));
    });

    // 밀린 할 일: 있을 때만 구역을 보인다. "오늘로" 버튼은 날짜를 오늘로 바꾼다
    overdueTasksList.innerHTML = "";
    overdueSection.hidden = data.overdue.length === 0;
    data.overdue.forEach(function (task) {
        overdueTasksList.appendChild(makeTaskRow(task, "오늘로", todayText, true));
    });
}

// 할 일의 일부(완료 여부, 날짜)를 바꾸고 목록을 다시 불러온다
async function updateTask(taskId, changes) {
    try {
        await sendRequest("/api/tasks/" + taskId, "PATCH", changes);
    } catch (error) {
        showToast("할 일을 바꾸지 못했습니다: " + error.message);
    }
    // 성공이든 실패든 서버에 있는 실제 모습으로 화면을 맞춘다
    await loadTodayTasks();
}

// 입력 칸의 글자를 오늘 할 일로 추가한다
async function addTask() {
    const content = taskInput.value.trim();
    if (!content) {
        return;
    }
    try {
        await sendRequest("/api/tasks", "POST", { content: content, date: todayText });
        taskInput.value = "";
        await loadTodayTasks();
    } catch (error) {
        showToast("할 일을 추가하지 못했습니다: " + error.message);
    }
}

taskAddButton.addEventListener("click", addTask);
taskInput.addEventListener("keydown", function (e) {
    // isComposing: 한글을 조합하는 중(마지막 글자가 아직 확정되지 않음)에 누른 Enter는 무시한다.
    // 그렇지 않으면 마지막 글자가 잘리거나 한 번 더 입력되는 일이 생긴다
    if (e.key === "Enter" && !e.isComposing) {
        addTask();
    }
});

// 오늘 탭을 새로 채운다. 탭을 열 때마다 실행된다
async function loadToday() {
    todayText = toDateText(new Date());
    todayTitle.textContent = new Date().toLocaleDateString("ko-KR", {
        year: "numeric", month: "long", day: "numeric", weekday: "long",
    });

    // 숨길 캘린더 목록(hiddenCalendarIds)이 설정에서 불러와진 뒤에 일정을 걸러야 한다
    await settingsReady;

    // 할 일은 내 컴퓨터에서 바로 오고, 일정은 Google을 거쳐 느릴 수 있다. 서로 기다리지 않게 따로 불러온다
    // (인터넷이 끊겨 일정이 실패해도 할 일은 보인다)
    loadTodayTasks().catch(function (error) {
        showToast("할 일을 불러오지 못했습니다: " + error.message);
    });
    loadTodayEvents().catch(function (error) {
        todayEventsList.innerHTML = "";
        showEmptyMessage(todayEventsList, "일정을 불러오지 못했습니다.");
        console.error("오늘 일정을 불러오지 못했습니다:", error);
    });
}

// ---------- 설정 탭 ----------

// 현재 설정값. 서버에서 불러오기 전에도 코드가 안전하도록 최소한의 모양을 미리 만들어 둔다
let settings = { defaultCalendarId: "" };
// 일정을 쓸 수 있는 캘린더 목록 ({id, primary}). loadCalendarList가 채운다
const editableCalendars = [];

const sliderListElement = document.getElementById("slider-list");
const defaultCalendarSelect = document.getElementById("default-calendar-select");

// 설정 이름 → 그 값을 담는 CSS 변수 이름. 슬라이더 값이 바뀌면 이 CSS 변수를 바꾼다
const SETTING_CSS_VARS = {
    fontSize: "--cal-font-size",
    monthCellHeight: "--month-cell-height",
    timeSlotHeight: "--time-slot-height",
    cellMaxWidth: "--cell-max-width",
    eventGap: "--event-gap",
    sidebarWidth: "--sidebar-width",
};

// 설정값을 CSS 변수에 넣어서 화면에 반영한다
function applySettings() {
    for (const key in SETTING_CSS_VARS) {
        if (settings[key] !== undefined) {
            // documentElement = <html>. :root에 정의한 CSS 변수는 여기서 바꾼다
            document.documentElement.style.setProperty(SETTING_CSS_VARS[key], settings[key] + "px");
        }
    }
    // 칸 크기가 바뀌었으니 FullCalendar가 레이아웃을 다시 계산하게 한다
    calendar.updateSize();
}

// 설정을 서버에 보내 settings.json에 저장한다
async function saveSettings() {
    try {
        await sendRequest("/api/settings", "PUT", settings);
    } catch (error) {
        showToast("설정을 저장하지 못했습니다: " + error.message);
    }
}

// 서버에서 설정을 받아와서 슬라이더를 만들고 화면에 반영한다
async function loadSettings() {
    try {
        const response = await fetch("/api/settings");
        if (!response.ok) {
            throw new Error("서버 오류: " + response.status);
        }
        const data = await response.json();
        settings = data.values;

        // 저장되어 있던 "숨기기로 한 캘린더"를 숨김 목록(Set)에 옮겨 담는다
        hiddenCalendarIds.clear();
        (settings.hiddenCalendarIds || []).forEach(function (id) {
            hiddenCalendarIds.add(id);
        });

        sliderListElement.innerHTML = "";  // 혹시 이미 있던 슬라이더를 비운다
        data.sliders.forEach(function (def) {
            // 한 줄: 이름 글자 + 슬라이더 + 현재 값 글자
            const row = document.createElement("label");
            row.className = "settings-row";

            const name = document.createElement("span");
            name.className = "settings-label";
            name.textContent = def.label;

            const slider = document.createElement("input");
            slider.type = "range";
            slider.min = def.min;
            slider.max = def.max;
            slider.step = def.step;
            slider.value = settings[def.key];
            slider.dataset.key = def.key;       // 나중에 "기본값으로"에서 이 슬라이더를 찾기 위한 표시
            slider.dataset.default = def.default;
            slider.dataset.unit = def.unit;

            const valueText = document.createElement("span");
            valueText.className = "settings-value";
            valueText.textContent = settings[def.key] + def.unit;

            row.append(name, slider, valueText);
            sliderListElement.appendChild(row);

            // input 이벤트: 슬라이더를 끄는 동안 계속 발생 → 화면에 즉시 반영
            slider.addEventListener("input", function () {
                settings[def.key] = Number(slider.value);
                valueText.textContent = slider.value + def.unit;
                applySettings();
            });
            // change 이벤트: 마우스를 놓았을 때 한 번 발생 → 이때 저장 (끄는 동안 저장 요청이 쏟아지지 않게)
            slider.addEventListener("change", saveSettings);
        });
    } catch (error) {
        // 실패해도 기본 모양으로 계속 쓸 수 있다
        console.error("설정을 불러오지 못했습니다:", error);
        showToast("설정을 불러오지 못해 기본값으로 표시합니다.");
    }
    applySettings();
}

// "기본값으로" 버튼: 모든 슬라이더를 기본값으로 되돌리고 저장한다 (기본 캘린더는 그대로 둔다)
document.getElementById("settings-reset").addEventListener("click", function () {
    sliderListElement.querySelectorAll("input[type=range]").forEach(function (slider) {
        slider.value = slider.dataset.default;
        settings[slider.dataset.key] = Number(slider.dataset.default);
        // 슬라이더 오른쪽의 값 글자도 기본값으로 바꾼다 (nextElementSibling = 바로 다음 요소)
        slider.nextElementSibling.textContent = slider.dataset.default + slider.dataset.unit;
    });
    applySettings();
    saveSettings();
});

// 일정 추가 창에서 미리 선택해둘 캘린더를 정한다.
// 설정 탭에서 지정한 캘린더가 있으면 그걸 쓰고, 없으면 내 기본 캘린더(primary), 그것도 없으면 쓸 수 있는 첫 캘린더
function updateDefaultCalendar() {
    const chosen = editableCalendars.find(function (cal) {
        return cal.id === settings.defaultCalendarId;
    });
    const primary = editableCalendars.find(function (cal) {
        return cal.primary;
    });
    const fallback = chosen || primary || editableCalendars[0];
    defaultCalendarId = fallback ? fallback.id : null;

    // 설정 탭의 선택 칸도 현재 설정에 맞춘다. 지정한 게 없으면 맨 위 "자동" 항목
    defaultCalendarSelect.value = chosen ? chosen.id : "";
}

// 설정 탭에서 기본 캘린더를 바꿨을 때
defaultCalendarSelect.addEventListener("change", function () {
    settings.defaultCalendarId = defaultCalendarSelect.value;
    updateDefaultCalendar();
    saveSettings();
});

// 지금 화면에 있는 일정 중 이 캘린더의 일정을 새 색으로 바꿔 그린다
function applyCalendarColor(calendarId, color) {
    calendar.batchRendering(function () {
        calendar.getEvents().forEach(function (event) {
            if (event.extendedProps.calendarId === calendarId) {
                event.setProp("backgroundColor", color);  // 칸 색 (종일 일정)
                event.setProp("borderColor", color);      // 테두리와 점 색 (시간 있는 일정의 동그라미)
            }
        });
    });
}

// 왼쪽 캘린더 목록(체크박스)을 만든다
async function loadCalendarList() {
    // index.html에서 만들어둔 빈 칸(<aside id="calendar-list">)
    const listElement = document.getElementById("calendar-list");

    try {
        // Flask의 /api/calendars에 캘린더 목록을 요청한다
        const response = await fetch("/api/calendars");
        if (!response.ok) {
            throw new Error("서버 오류: " + response.status);
        }
        const calendars = await response.json();

        // 저장된 기본 캘린더 설정을 쓰려면 설정을 먼저 불러온 상태여야 한다
        await settingsReady;

        // 캘린더마다 "체크박스 + 색 점 + 이름" 한 줄을 만든다
        calendars.forEach(function (cal) {
            // document.createElement: 자바스크립트로 HTML 요소를 새로 만든다
            const label = document.createElement("label");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            // 기본은 모두 선택. 지난번에 숨기기로 저장해둔 캘린더만 체크를 꺼둔다
            checkbox.checked = !hiddenCalendarIds.has(cal.id);

            // 캘린더 색을 보여주는 동그라미. 누르면 색 선택 창이 열리고, 고른 색은 Google Calendar에도 저장된다.
            // <input type="color">는 브라우저가 기본으로 주는 색 선택 도구다
            const dot = document.createElement("input");
            dot.type = "color";
            dot.className = "color-dot";
            dot.value = cal.color;
            dot.title = "클릭해서 캘린더 색 바꾸기";

            // 실패하면 이전 색으로 되돌리려고, 지금 색을 기억해둔다
            let currentColor = cal.color;

            // change 이벤트: 색 선택 창에서 색을 정하고 닫았을 때 발생한다
            dot.addEventListener("change", async function () {
                const newColor = dot.value;
                const oldColor = currentColor;

                // Google의 응답을 기다리지 않고 화면에는 먼저 반영한다
                applyCalendarColor(cal.id, newColor);
                currentColor = newColor;

                try {
                    await sendRequest("/api/calendar-color", "PATCH", { calendarId: cal.id, color: newColor });
                } catch (error) {
                    // Google이 거절하면 원래 색으로 되돌리고 이유를 알려준다
                    applyCalendarColor(cal.id, oldColor);
                    dot.value = oldColor;
                    currentColor = oldColor;
                    showToast(error.message);
                }
            });

            // 일정을 쓸 수 있는 캘린더만 일정 입력 창과 설정 탭의 캘린더 선택 칸에 넣는다
            if (cal.canEdit) {
                eventCalendarSelect.add(new Option(cal.name, cal.id));
                defaultCalendarSelect.add(new Option(cal.name, cal.id));
                editableCalendars.push({ id: cal.id, primary: cal.primary });
            }

            // label 안에 체크박스, 색 점, 이름 글자를 차례로 넣는다
            label.append(checkbox, dot, cal.name);
            // 만든 한 줄을 목록 칸에 붙인다
            listElement.appendChild(label);

            // 체크 상태가 바뀔 때마다 실행할 일을 등록한다
            checkbox.addEventListener("change", function () {
                // 숨길 목록에 넣거나 뺀다 (달을 넘겼을 때를 위해 기억해둔다)
                if (checkbox.checked) {
                    hiddenCalendarIds.delete(cal.id);
                } else {
                    hiddenCalendarIds.add(cal.id);
                }
                // 다음 실행에도 유지되도록 설정 파일에 저장한다 (Set을 리스트로 바꿔서 보낸다)
                settings.hiddenCalendarIds = Array.from(hiddenCalendarIds);
                saveSettings();

                // 지금 화면에 있는 일정 중 이 캘린더의 것만 숨기거나 다시 보이게 한다.
                // batchRendering: 여러 일정을 바꾸는 동안 화면을 한 번만 다시 그리게 한다
                calendar.batchRendering(function () {
                    calendar.getEvents().forEach(function (event) {
                        if (event.extendedProps.calendarId === cal.id) {
                            event.setProp("display", checkbox.checked ? "auto" : "none");
                        }
                    });
                });
            });
        });

        // 일정이 설정보다 먼저 도착해서 이미 화면에 그려졌을 수도 있으니,
        // 숨기기로 한 캘린더의 일정을 한 번 더 숨긴다
        calendar.batchRendering(function () {
            calendar.getEvents().forEach(function (event) {
                if (hiddenCalendarIds.has(event.extendedProps.calendarId)) {
                    event.setProp("display", "none");
                }
            });
        });

        // 선택 칸을 모두 채웠으니, 새 일정에 미리 선택할 기본 캘린더를 정한다
        updateDefaultCalendar();
    } catch (error) {
        console.error("캘린더 목록을 불러오지 못했습니다:", error);
        listElement.append("캘린더 목록을 불러오지 못했습니다.");
    }
}

// 위 함수들을 실행한다 (함수는 만들기만 하면 실행되지 않고, 이렇게 불러야 실행된다)
// 설정과 캘린더 목록을 동시에 불러온다. loadCalendarList는 settingsReady(설정 불러오기가 끝났다는 약속)를 기다린다
const settingsReady = loadSettings();
loadCalendarList();
