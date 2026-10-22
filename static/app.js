// 화면 코드(JavaScript)에서 오류가 나면 조용히 멈추지 않고 화면 아래 알림으로 알려준다.
// 창 안에서는 개발자 도구를 열기 어려워서, 무슨 일이 생겼는지 바로 보이게 하려는 것이다
window.addEventListener("error", function (e) {
    showToast("화면 오류: " + e.message);
});
// await 하다가 실패했는데 아무도 잡지 않은 오류도 같은 방식으로 알려준다
window.addEventListener("unhandledrejection", function (e) {
    showToast("화면 오류: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

// 탭 버튼 6개와 탭 내용 6개를 모두 찾아서 변수에 담는다
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

        // 6. 프로젝트 탭도 열 때마다 새로 불러온다. (오늘 탭에서 프로젝트에 연결해 추가한 할 일이 진행률에 반영되어야 한다)
        if (tabName === "projects") {
            loadProjects().catch(function (error) {
                showToast("프로젝트를 불러오지 못했습니다: " + error.message);
            });
        }

        // 7. 우선순위 탭도 열 때마다 새로 불러온다. (다른 탭에서 할 일을 끝내거나 추가했을 수 있다)
        if (tabName === "priority") {
            loadPriority().catch(function (error) {
                showToast("할 일을 불러오지 못했습니다: " + error.message);
            });
        }

        // 8. 노트 탭은 열 때 목록을 새로 받고, 다른 탭으로 나가기 전에는 고치던 노트를 저장한다
        if (tabName === "notes") {
            openNotesTab();
        } else {
            flushNote();
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

    // 이전/다음 버튼에 마우스를 올리면 뜨는 설명. $0은 FullCalendar가 지금 보기에 맞춰 "달", "주", "일"로 바꿔 넣는다.
    // 키보드 ←/→로도 이동할 수 있다는 것을 알려준다 (아래 "키보드 화살표" 참고)
    buttonHints: { prev: "이전 $0 (←)", next: "다음 $0 (→)" },

    // 일정 앞에 붙는 시간 표기: 24시간제, 두 자리 맞춤 (예: 07:45, 19:45)
    eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },

    // 주간/일간 보기 왼쪽의 시간 눈금도 같은 형식으로 맞춘다
    slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },

    // 달력 높이: 창 높이에서 위쪽 탭 영역과 여백만큼 뺀 만큼 쓴다 (--chrome-height는 style.css에 정해둔 값)
    height: "calc(100vh - var(--chrome-height))",

    // 일정을 드래그로 옮기거나 끝을 늘리는 걸 허용한다. (쓸 수 없는 캘린더의 일정은 서버가 editable: false로 막아준다)
    editable: true,

    // 아래 네 개는 "사용자가 이런 동작을 했을 때 실행할 함수"를 FullCalendar에 등록하는 것이다.
    // 함수의 실제 내용은 이 파일 아래쪽에 있다
    dateClick: openAddDialog,        // 빈 날짜/시간 칸을 클릭
    eventClick: openEditDialog,      // 일정을 클릭
    eventDrop: saveEventTime,        // 일정을 다른 날짜/시간으로 드래그
    eventResize: saveEventTime,      // 일정의 끝을 잡아 길이를 바꿈

    // 일정이 화면에 그려질 때마다 마우스를 올렸을 때 뜨는 설명(툴팁)을 단다. 제목이 잘려 보여도 전체를 읽을 수 있다.
    // 시간 있는 일정은 "17:50–19:00  제목", 여러 날에 걸친 종일 일정은 "10/29 – 10/31  제목"
    eventDidMount: function (info) {
        info.el.title = describeEvent(info.event);
    },

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
            // 서버가 오류를 돌려줬다면(예: 인터넷 끊김) 오류로 취급한다. 서버가 알려준 이유가 있으면 그걸 쓴다
            if (!response.ok) {
                throw new Error(await errorMessageFrom(response));
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
            showToast("일정을 불러오지 못했습니다: " + error.message);
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

// 일정 하나를 툴팁용 글자로 만든다
function describeEvent(event) {
    let when = "";
    if (!event.allDay && event.start) {
        when = toTimeText(event.start) + (event.end ? "–" + toTimeText(event.end) : "");
    } else if (event.allDay && event.start && event.end) {
        // 종일 일정의 end는 "포함하지 않는 날짜"라서 하루를 빼야 마지막 날이 된다
        const last = addDays(event.end, -1);
        if (last > event.start) {
            when = (event.start.getMonth() + 1) + "/" + event.start.getDate() + " – " + (last.getMonth() + 1) + "/" + last.getDate();
        }
    }
    return when ? when + "  " + event.title : event.title;
}

// 화면 아래에 알림을 4초 동안 띄운다
let toastTimer = null;
function showToast(message, duration = 4000) {
    toastElement.textContent = message;
    toastElement.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
        toastElement.classList.remove("show");
    }, duration);
}

// 실패한 응답에서 화면에 보여줄 이유를 꺼낸다. 서버가 {"error": "이유"}를 담아 보냈으면 그 이유를,
// 아니면(서버 응답이 JSON이 아닌 경우 등) "서버 오류: 번호"를 돌려준다
async function errorMessageFrom(response) {
    try {
        const data = await response.json();
        if (data.error) {
            return data.error;
        }
    } catch (error) {
        // JSON이 아니면 아래의 기본 메시지를 쓴다
    }
    return "서버 오류: " + response.status;
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
        throw new Error(await errorMessageFrom(response));
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

// ---------- 키보드 화살표로 이동 ----------

// 화살표 키를 "이동"으로 쓰면 안 되는 상황인가? 글자를 쓰는 칸, 선택 칸, 슬라이더 등은 화살표를 자기 용도로 쓰므로 건드리지 않는다.
// 체크박스와 버튼은 화살표를 쓰지 않으니, 방금 클릭해서 포커스가 남아 있어도 이동할 수 있게 허용한다
function arrowKeysBelongToElement() {
    // 일정 창, 프로젝트 창처럼 모달 창이 열려 있으면 화면 뒤의 달력은 움직이지 않는다
    if (document.querySelector("dialog[open]")) {
        return true;
    }
    const element = document.activeElement;
    if (!element || element === document.body) {
        return false;
    }
    if (element.tagName === "INPUT") {
        return element.type !== "checkbox";
    }
    return element.tagName === "SELECT" || element.tagName === "TEXTAREA" || element.isContentEditable;
}

// ←/→: 캘린더 탭에서는 이전/다음 달(주간 보기면 주, 일간 보기면 일), 오늘 탭에서는 전날/다음 날
document.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") {
        return;
    }
    // Ctrl, Alt, Shift, Win과 함께 누른 조합은 다른 용도(글자 단위 이동, 윈도우 단축키 등)이므로 건드리지 않는다
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) {
        return;
    }
    if (arrowKeysBelongToElement()) {
        return;
    }

    const goingBack = e.key === "ArrowLeft";
    if (document.getElementById("calendar").classList.contains("active")) {
        // prev()/next()는 FullCalendar가 지금 보기(월간/주간/일간)에 맞는 만큼 움직여준다
        if (goingBack) {
            calendar.prev();
        } else {
            calendar.next();
        }
    } else if (document.getElementById("today").classList.contains("active")) {
        (goingBack ? dayPrevButton : dayNextButton).click();
    } else {
        return;  // 프로젝트, 설정 탭에서는 아무것도 하지 않는다
    }
    e.preventDefault();  // 화면이 가로로 스크롤되는 등 브라우저의 기본 동작을 막는다
});

// ---------- 오늘 탭 ----------

const todayTitle = document.getElementById("today-title");
const todayEventsList = document.getElementById("today-events");
const todayTasksList = document.getElementById("today-tasks");
const overdueSection = document.getElementById("overdue-section");
const overdueTasksList = document.getElementById("overdue-tasks");
const taskInput = document.getElementById("task-input");
const taskAddButton = document.getElementById("task-add-button");
const taskProjectSelect = document.getElementById("task-project");
const eventsHeading = document.getElementById("events-heading");
const tasksHeading = document.getElementById("tasks-heading");
const dayPrevButton = document.getElementById("day-prev");
const dayNextButton = document.getElementById("day-next");
const dayTodayButton = document.getElementById("day-today");

// 진짜 오늘 날짜("2026-10-19"). 탭을 열 때마다 새로 구한다. 켜둔 채 자정을 넘길 수도 있기 때문이다
let todayText = toDateText(new Date());
// 지금 화면이 보여주는 날짜. 탭을 처음 열면 오늘이고, ◀ ▶로 바꿀 수 있다. 일정, 할 일, 새 할 일 추가가 모두 이 날짜를 따른다
let viewedDate = todayText;

// 목록(<ul>)에 "내용이 없을 때" 보여줄 회색 안내 문장 한 줄을 넣는다
function showEmptyMessage(listElement, message) {
    const item = document.createElement("li");
    item.className = "today-empty";
    item.textContent = message;
    listElement.appendChild(item);
}

// 오늘의 일정을 서버에서 받아와서 왼쪽 목록에 그린다
async function loadTodayEvents() {
    // 요청을 보낸 시점의 날짜를 기억해둔다. 응답이 오기 전에 ◀ ▶로 다른 날로 넘어갔다면 이 응답은 버린다
    const date = viewedDate;
    // 캘린더 탭이 쓰는 /api/events를 그대로 쓴다. 그날 0시 ~ 다음 날 0시를 요청한다
    const response = await fetch(
        "/api/events?start=" + date + "&end=" + addDaysToText(date, 1)
    );
    if (!response.ok) {
        throw new Error("서버 오류: " + response.status);
    }
    const events = await response.json();
    if (date !== viewedDate) {
        return;
    }

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
        showEmptyMessage(todayEventsList, "일정이 없습니다.");
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

// 할 일 한 줄(<li>)을 만든다. 오늘 탭과 프로젝트 카드가 같이 쓴다. options는 이런 값들을 담은 묶음이다:
//   reload: 할 일을 바꾸거나 지운 뒤 목록을 다시 불러오는 함수 (오늘 탭이면 loadTodayTasks, 프로젝트 탭이면 loadProjects)
//   moveLabel/moveDate: 날짜를 옮기는 버튼("내일로" 등)의 글자와 옮겨 갈 날짜. moveLabel이 없으면 버튼을 안 만든다
//   showDate: 줄에 날짜를 같이 보일지 (밀린 할 일, 프로젝트의 날짜 잡힌 단계)
//   showProject: 줄에 프로젝트 이름표를 같이 보일지 (오늘 탭)
//   editDeadline: 마감일을 바꾸는 버튼을 둘지 (프로젝트 카드). false면 마감일이 있을 때 글자로만 보여준다
//   derived: 하위 단계가 있는 단계인지. true면 체크박스를 잠그고(하위 단계를 다 끝내면 저절로 체크됨) 날짜 옮기기를 막는다
//   countText: 줄에 붙일 "2/3" 같은 하위 단계 진행 글자
//   extraButtons: 삭제 버튼 앞에 더 넣을 버튼들의 리스트 (프로젝트 카드의 "+ 하위")
//   unscheduleOnly: 오늘 탭에서 쓴다. 프로젝트에 연결된 할 일은 지우는 대신 "오늘에서만 빼기"(날짜 제거)로 바꾼다
function makeTaskRow(task, options) {
    const item = document.createElement("li");
    item.className = "task-row";

    // 완료 체크박스. 체크하면 서버에 done을 저장하고 목록을 다시 불러온다 (끝낸 것은 아래로 내려간다)
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done === 1;
    checkbox.disabled = !!options.derived;  // 하위 단계가 있는 단계는 직접 체크하지 않는다
    checkbox.addEventListener("change", function () {
        updateTask(task.id, { done: checkbox.checked }, options.reload);
    });

    const content = document.createElement("span");
    content.className = "task-content" + (task.done === 1 ? " done" : "");
    content.textContent = task.content;

    item.append(checkbox, content);

    if (options.countText) {
        const count = document.createElement("span");
        count.className = "task-count";
        count.textContent = options.countText;
        item.appendChild(count);
    }

    // 프로젝트에 연결된 할 일이면 프로젝트 색 동그라미와 이름을 붙인다. 하위 단계면 상위 단계 이름도 같이 붙는다
    if (options.showProject && task.project_name) {
        item.appendChild(makeProjectChip(task.project_name, task.project_color, task.parent_content));
    }

    // 마우스를 올렸을 때만 줄 오른쪽에 뜨는 버튼들을 모아두는 묶음 (모양은 style.css의 .task-actions).
    // 버튼이 줄마다 항상 늘어서 있으면 화면이 복잡해서, 평소에는 숨겨두고 필요할 때만 보이게 한다
    const actions = document.createElement("span");
    actions.className = "task-actions";

    // 마감일: 프로젝트 카드에서는 눌러서 바꿀 수 있는 버튼, 그 밖에서는 글자로만 보여준다.
    // 마감일이 정해져 있으면 줄에 항상 보이고, 아직 없으면 "마감일" 버튼이 마우스를 올렸을 때만 뜬다
    if (options.editDeadline) {
        const deadlineControl = makeDeadlineControl(task, options.reload);
        (task.deadline ? item : actions).appendChild(deadlineControl);
    } else if (task.deadline) {
        const deadline = describeDeadline(task.deadline);
        const deadlineText = document.createElement("span");
        deadlineText.className = "task-deadline" + (deadline.urgent && task.done !== 1 ? " urgent" : "");
        deadlineText.textContent = "마감 " + deadline.short;
        item.appendChild(deadlineText);
    }

    if (options.showDate && task.date) {
        const date = document.createElement("span");
        date.className = "task-date";
        date.textContent = task.date.slice(5).replace("-", "/");  // "2026-10-17" → "10/17"
        item.appendChild(date);
    }

    // 끝낸 할 일은 옮길 필요가 없으므로 버튼을 만들지 않는다
    if (task.done !== 1 && options.moveLabel) {
        const moveButton = document.createElement("button");
        moveButton.textContent = options.moveLabel;
        moveButton.addEventListener("click", function () {
            updateTask(task.id, { date: options.moveDate }, options.reload);
        });
        actions.appendChild(moveButton);
    }

    (options.extraButtons || []).forEach(function (button) {
        actions.appendChild(button);
    });

    // 오늘 탭의 프로젝트 할 일: 지우면 프로젝트의 단계까지 사라지므로, 지우는 대신 오늘 목록에서만 뺀다.
    // 날짜(date)만 비우면 단계는 프로젝트 카드에 그대로 남는다. 끝낸 할 일은 "오늘 한 일의 기록"이라서 빼기 버튼을 두지 않는다
    // (지우고 싶으면 프로젝트 카드에서 지운다)
    if (options.unscheduleOnly && task.project_id) {
        if (task.done !== 1 && task.date) {
            const removeButton = document.createElement("button");
            removeButton.textContent = "빼기";
            removeButton.title = "오늘 할 일에서만 빼고, 프로젝트에는 그대로 남겨둡니다";
            removeButton.addEventListener("click", function () {
                updateTask(task.id, { date: null }, options.reload);
            });
            actions.appendChild(removeButton);
        }
        if (actions.children.length > 0) {
            item.appendChild(actions);
        }
        return item;
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
            await options.reload();
        } catch (error) {
            showToast("할 일을 지우지 못했습니다: " + error.message);
        }
    });
    actions.appendChild(deleteButton);
    item.appendChild(actions);

    return item;
}

// 서버에서 할 일 목록을 받아와서 오른쪽에 그린다
async function loadTodayTasks() {
    const date = viewedDate;  // loadTodayEvents와 같은 이유로, 요청 시점의 날짜를 기억해둔다
    const response = await fetch("/api/tasks?date=" + date);
    if (!response.ok) {
        throw new Error("서버 오류: " + response.status);
    }
    const data = await response.json();
    if (date !== viewedDate) {
        return;
    }
    const isToday = date === todayText;

    // 그날의 할 일: 버튼은 날짜를 다음 날로 바꾼다. 날짜가 보고 있는 날과 다른 항목
    // (예: 17일에 적고 19일에 끝낸 일)은 원래 날짜를 같이 보여준다
    todayTasksList.innerHTML = "";
    if (data.tasks.length === 0) {
        showEmptyMessage(todayTasksList, isToday ? "오늘 할 일이 없습니다." : "할 일이 없습니다.");
    }
    data.tasks.forEach(function (task) {
        todayTasksList.appendChild(makeTaskRow(task, {
            reload: loadTodayTasks,
            moveLabel: isToday ? "내일로" : "다음 날로",
            moveDate: addDaysToText(date, 1),
            showDate: task.date !== date,
            showProject: true,
            unscheduleOnly: true,
        }));
    });

    // 밀린 할 일은 "오늘 기준"의 개념이라서 오늘을 볼 때만 보인다. 있을 때만 구역을 보이고, "오늘로" 버튼은 날짜를 오늘로 바꾼다
    overdueTasksList.innerHTML = "";
    overdueSection.hidden = !isToday || data.overdue.length === 0;
    if (isToday) {
        data.overdue.forEach(function (task) {
            overdueTasksList.appendChild(makeTaskRow(task, {
                reload: loadTodayTasks,
                moveLabel: "오늘로",
                moveDate: todayText,
                showDate: true,
                showProject: true,
                unscheduleOnly: true,
            }));
        });
    }
}

// 할 일의 일부(완료 여부, 날짜)를 바꾸고 reload()로 목록을 다시 불러온다
async function updateTask(taskId, changes, reload) {
    try {
        await sendRequest("/api/tasks/" + taskId, "PATCH", changes);
    } catch (error) {
        showToast("할 일을 바꾸지 못했습니다: " + error.message);
    }
    // 성공이든 실패든 서버에 있는 실제 모습으로 화면을 맞춘다
    await reload();
}

// 프로젝트 이름표: 프로젝트 색 동그라미 + 이름. 오늘 탭의 할 일 줄에 쓴다.
// parentContent(상위 단계 이름)가 있으면 "프로젝트 › 상위 단계"로 보여줘서, 하위 단계가 어느 일의 일부인지 알 수 있게 한다
function makeProjectChip(name, color, parentContent) {
    const chip = document.createElement("span");
    chip.className = "project-chip";

    const dot = document.createElement("span");
    dot.className = "event-dot";
    dot.style.backgroundColor = color;

    chip.append(dot, parentContent ? name + " › " + parentContent : name);  // 글자는 append로 넣으면 HTML이 아니라 그냥 글자로 들어간다
    return chip;
}

// 마감일을 바꾸는 버튼을 만든다 (프로젝트 카드의 단계 줄). 마감일이 없으면 "마감일", 있으면 "마감 11/18 (D-30)"이 적혀 있다.
// 누르면 날짜 고르는 창이 열린다. <input type="date">를 투명하게 버튼 위에 겹쳐두고 showPicker()로 그 창을 연다.
// 마감일이 있을 때는 옆에 지우는 ✕ 버튼도 붙는다
function makeDeadlineControl(task, reload) {
    const wrapper = document.createElement("span");
    wrapper.className = "deadline-control";

    const input = document.createElement("input");
    input.type = "date";
    input.className = "deadline-input";
    input.value = task.deadline || "";

    const button = document.createElement("button");
    if (task.deadline) {
        const deadline = describeDeadline(task.deadline);
        button.textContent = "마감 " + deadline.short;
        // 마감이 임박했거나 지났는데 아직 안 끝낸 단계만 빨갛게 강조한다
        if (deadline.urgent && task.done !== 1) {
            button.className = "urgent";
        }
    } else {
        button.textContent = "마감일";
    }
    button.title = "마감일 정하기";
    button.addEventListener("click", function () {
        try {
            input.showPicker();  // 날짜 고르는 창을 연다
        } catch (error) {
            // showPicker를 쓸 수 없는 환경이면, 날짜 칸을 그대로 보여줘서 직접 입력할 수 있게 한다
            input.classList.add("visible");
            input.focus();
        }
    });
    // 날짜를 고르면(change) 서버에 저장하고 목록을 다시 불러온다
    input.addEventListener("change", function () {
        updateTask(task.id, { deadline: input.value || null }, reload);
    });
    wrapper.append(input, button);

    if (task.deadline) {
        const clear = document.createElement("button");
        clear.className = "clear";  // 줄에 마우스를 올렸을 때만 보이게 하려고 style.css가 찾는 이름
        clear.textContent = "✕";
        clear.title = "마감일 지우기";
        clear.addEventListener("click", function () {
            updateTask(task.id, { deadline: null }, reload);
        });
        wrapper.appendChild(clear);
    }
    return wrapper;
}

// 입력 칸의 글자를 지금 보고 있는 날의 할 일로 추가한다 (▶로 내일을 열고 적으면 내일 계획이 된다)
async function addTask() {
    const content = taskInput.value.trim();
    if (!content) {
        return;
    }
    try {
        await sendRequest("/api/tasks", "POST", {
            content: content,
            date: viewedDate,
            // 고른 프로젝트가 있으면 그 번호를 보내서 연결한다. "프로젝트 없음"(빈 글자)이면 null
            projectId: taskProjectSelect.value ? Number(taskProjectSelect.value) : null,
        });
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

// 보여줄 날짜를 dateText("2026-10-19")로 바꾸고, 제목과 버튼을 맞춘 뒤 그날의 일정과 할 일을 불러온다
function showDay(dateText) {
    viewedDate = dateText;
    const isToday = dateText === todayText;

    // "2026-10-19" → 이 컴퓨터 시간대의 Date. (new Date("2026-10-19")는 UTC 0시로 해석되어 하루 어긋날 수 있어서 직접 만든다)
    const [year, month, day] = dateText.split("-").map(Number);
    todayTitle.textContent = new Date(year, month - 1, day).toLocaleDateString("ko-KR", {
        year: "numeric", month: "long", day: "numeric", weekday: "long",
    });
    eventsHeading.textContent = isToday ? "오늘의 일정" : "일정";
    tasksHeading.textContent = isToday ? "오늘 할 일" : "할 일";
    dayTodayButton.hidden = isToday;

    // 그날의 일정과 할 일은 내용이 바뀌기 전의 것이 남아 보이지 않게 먼저 비운다
    todayEventsList.innerHTML = "";
    todayTasksList.innerHTML = "";
    overdueSection.hidden = true;

    // 할 일은 내 컴퓨터에서 바로 오고, 일정은 Google을 거쳐 느릴 수 있다. 서로 기다리지 않게 따로 불러온다
    // (인터넷이 끊겨 일정이 실패해도 할 일은 보인다)
    loadTodayTasks().catch(function (error) {
        showToast("할 일을 불러오지 못했습니다: " + error.message);
    });
    loadTodayEvents().catch(function (error) {
        console.error("일정을 불러오지 못했습니다:", error);
        // 그 사이 다른 날로 넘어갔다면 이 오류는 지금 화면과 상관없으므로 건드리지 않는다
        if (dateText === viewedDate) {
            todayEventsList.innerHTML = "";
            showEmptyMessage(todayEventsList, "일정을 불러오지 못했습니다.");
        }
    });
}

// 오늘 탭을 처음 열 때 실행된다 (탭을 누를 때마다). 항상 "진짜 오늘"로 시작한다
async function loadToday() {
    todayText = toDateText(new Date());

    // 숨길 캘린더 목록(hiddenCalendarIds)이 설정에서 불러와진 뒤에 일정을 걸러야 한다
    await settingsReady;

    showDay(todayText);

    // 할 일 입력줄의 프로젝트 선택 칸도 최신 프로젝트 목록으로 채운다
    loadProjects().catch(function (error) {
        console.error("프로젝트 목록을 불러오지 못했습니다:", error);
    });

    // D-day 줄도 새로 그린다. 날짜가 바뀌었을 수 있어서 D-숫자가 달라질 수 있다
    loadDdays().catch(function (error) {
        console.error("D-day를 불러오지 못했습니다:", error);
    });
}

// ◀ ▶ 버튼: 보고 있는 날에서 하루 전/후로 넘긴다. "오늘로 돌아가기"는 진짜 오늘로 간다
dayPrevButton.addEventListener("click", function () {
    showDay(addDaysToText(viewedDate, -1));
});
dayNextButton.addEventListener("click", function () {
    showDay(addDaysToText(viewedDate, 1));
});
dayTodayButton.addEventListener("click", function () {
    showDay(todayText);
});

// ---------- D-day ----------
// 오늘 탭 맨 위의 "기말고사 D-50" 줄. D-day는 이름과 날짜만 있는 작은 데이터이고, 프로젝트의 마감일과는 별개다.

const ddayStrip = document.getElementById("dday-strip");
const ddayDialog = document.getElementById("dday-dialog");
const ddayDialogTitle = document.getElementById("dday-dialog-title");
const ddayNameInput = document.getElementById("dday-name");
const ddayDateInput = document.getElementById("dday-date");
const ddayColorInput = document.getElementById("dday-color");
const ddayError = document.getElementById("dday-error");
const ddayDeleteButton = document.getElementById("dday-delete");

// 마지막으로 서버에서 받은 D-day 목록 (날짜 순)
let ddaysCache = [];
// 수정 중인 D-day. null이면 "새 D-day" 모드다
let editingDday = null;
// 삭제 버튼을 한 번 눌러서 "정말 삭제?" 확인을 기다리는 중인지
let ddayDeleteArmed = false;
// 이미 지난 D-day도 같이 보여줄지. 지난 것은 평소에 숨기고, 이 스위치로만 볼 수 있다
let showPastDdays = false;

// 오늘부터 그날까지 며칠 남았는지. 오늘이면 0, 내일이면 1, 어제면 -1
function daysUntil(dateText) {
    const [year, month, day] = dateText.split("-").map(Number);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 날짜끼리 빼면 밀리초가 나온다. 하루(86400000밀리초)로 나눠서 며칠인지 센다. (써머타임 때문에 생기는 1시간 오차는 반올림이 지워준다)
    return Math.round((new Date(year, month - 1, day) - todayStart) / 86400000);
}

// 남은 날 글자: 50일 남음 "D-50", 오늘 "D-DAY", 3일 지남 "D+3"
function ddayLabel(days) {
    if (days > 0) {
        return "D-" + days;
    }
    return days === 0 ? "D-DAY" : "D+" + (-days);
}

// 서버에서 D-day 목록을 받아와서 줄을 다시 그린다
async function loadDdays() {
    const response = await fetch("/api/ddays");
    if (!response.ok) {
        throw new Error(await errorMessageFrom(response));
    }
    ddaysCache = await response.json();
    renderDdays();
}

// D-day 줄을 그린다: 남은 날이 적은 순서의 알약들, (지난 것이 있으면) 토글, 추가 버튼
function renderDdays() {
    ddayStrip.innerHTML = "";

    const upcoming = [];
    const past = [];
    ddaysCache.forEach(function (dday) {
        (daysUntil(dday.date) >= 0 ? upcoming : past).push(dday);
    });
    // 지난 것은 가장 최근에 지난 것이 먼저 오게 뒤집는다. (서버는 날짜가 빠른 순으로 준다)
    past.reverse();

    upcoming.forEach(function (dday) {
        ddayStrip.appendChild(makeDdayChip(dday, false));
    });

    if (showPastDdays) {
        past.forEach(function (dday) {
            ddayStrip.appendChild(makeDdayChip(dday, true));
        });
    }

    // 지난 D-day는 평소에 숨겨두는데, 숨기면 날짜를 고쳐서 되살릴 방법이 없어진다. 그래서 있을 때만 보이는 토글을 둔다
    if (past.length > 0) {
        const toggle = document.createElement("button");
        toggle.className = "dday-toggle";
        toggle.textContent = showPastDdays ? "지난 D-day 숨기기" : "지난 D-day " + past.length + "개 보기";
        toggle.addEventListener("click", function () {
            showPastDdays = !showPastDdays;
            renderDdays();
        });
        ddayStrip.appendChild(toggle);
    }

    const addButton = document.createElement("button");
    addButton.className = "dday-add";
    addButton.textContent = "+ D-day";
    addButton.title = "D-day 추가 (예: 기말고사)";
    addButton.addEventListener("click", function () {
        openDdayDialog(null);
    });
    ddayStrip.appendChild(addButton);
}

// D-day 알약 하나. 누르면 수정 창이 열린다
function makeDdayChip(dday, isPast) {
    const days = daysUntil(dday.date);
    const chip = document.createElement("button");
    chip.className = "dday-chip" + (isPast ? " past" : "") + (!isPast && days <= 7 ? " urgent" : "");
    chip.title = dday.name + " · " + dday.date + " (눌러서 수정)";

    const dot = document.createElement("span");
    dot.className = "dday-dot";
    dot.style.backgroundColor = dday.color;

    const name = document.createElement("span");
    name.className = "dday-name";
    name.textContent = dday.name;

    const label = document.createElement("span");
    label.className = "dday-days";
    label.textContent = ddayLabel(days);

    chip.append(dot, name, label);
    chip.addEventListener("click", function () {
        openDdayDialog(dday);
    });
    return chip;
}

// D-day 추가/수정 창을 연다. dday가 없으면 새 D-day
function openDdayDialog(dday) {
    editingDday = dday || null;
    ddayDeleteArmed = false;
    ddayDeleteButton.textContent = "삭제";
    ddayDeleteButton.hidden = !editingDday;
    ddayDialogTitle.textContent = editingDday ? "D-day 수정" : "새 D-day";

    ddayNameInput.value = editingDday ? editingDday.name : "";
    ddayDateInput.value = editingDday ? editingDday.date : "";
    ddayColorInput.value = editingDday ? editingDday.color : PROJECT_COLORS[ddaysCache.length % PROJECT_COLORS.length];
    ddayError.textContent = "";

    ddayDialog.showModal();
    ddayNameInput.focus();
}

// 저장 버튼: 새 D-day면 POST, 수정이면 PATCH
async function saveDday() {
    const name = ddayNameInput.value.trim();
    if (!name) {
        ddayError.textContent = "이름을 입력하세요.";
        return;
    }
    if (!ddayDateInput.value) {
        ddayError.textContent = "날짜를 고르세요.";
        return;
    }

    const body = { name: name, date: ddayDateInput.value, color: ddayColorInput.value };
    try {
        ddayError.textContent = "저장하는 중...";
        if (editingDday) {
            await sendRequest("/api/ddays/" + editingDday.id, "PATCH", body);
        } else {
            await sendRequest("/api/ddays", "POST", body);
        }
        ddayDialog.close();
        await loadDdays();
    } catch (error) {
        ddayError.textContent = error.message;
    }
}

// 삭제 버튼: 일정, 할 일, 프로젝트와 같이 두 번 눌러야 지워진다
async function deleteDday() {
    if (!ddayDeleteArmed) {
        ddayDeleteArmed = true;
        ddayDeleteButton.textContent = "정말 삭제? (한 번 더)";
        return;
    }
    try {
        await sendRequest("/api/ddays/" + editingDday.id, "DELETE");
        ddayDialog.close();
        await loadDdays();
    } catch (error) {
        ddayError.textContent = error.message;
    }
}

document.getElementById("dday-save").addEventListener("click", saveDday);
document.getElementById("dday-cancel").addEventListener("click", function () {
    ddayDialog.close();
});
ddayDeleteButton.addEventListener("click", deleteDday);
ddayNameInput.addEventListener("keydown", function (e) {
    // 한글 조합 중의 Enter는 무시한다 (다른 입력 칸과 같은 이유)
    if (e.key === "Enter" && !e.isComposing) {
        saveDday();
    }
});

// ---------- 프로젝트 탭 ----------

const projectListElement = document.getElementById("project-list");
const projectAddButton = document.getElementById("project-add-button");
const projectDialog = document.getElementById("project-dialog");
const projectDialogTitle = document.getElementById("project-dialog-title");
const projectNameInput = document.getElementById("project-name");
const projectDeadlineInput = document.getElementById("project-deadline");
const projectColorInput = document.getElementById("project-color");
const projectError = document.getElementById("project-error");
const projectDeleteButton = document.getElementById("project-delete");

// 새 프로젝트 창에 미리 골라둘 색들 (서버의 PROJECT_COLORS와 같은 목록). 프로젝트 수에 따라 차례로 쓴다
const PROJECT_COLORS = ["#4a7cff", "#e8590c", "#2f9e44", "#ae3ec9", "#d6336c", "#1098ad", "#f08c00"];

// 마지막으로 서버에서 받은 프로젝트 목록 (마감일 순). 화면을 다시 그리거나 선택 칸을 채울 때 쓴다
let projectsCache = [];
// 수정 중인 프로젝트. null이면 "새 프로젝트" 모드다
let editingProject = null;
// 삭제 버튼을 한 번 눌러서 "정말 삭제?" 확인을 기다리는 중인지
let projectDeleteArmed = false;
// 단계를 추가한 직후 다시 그린 카드에서, 입력 칸에 커서를 되돌려둘 프로젝트 번호. 단계를 연달아 입력하기 편하게 하려는 것이다
let projectToFocus = null;
// "+ 하위"로 하위 단계 입력 칸을 열어둔 단계의 번호들. 하위 단계를 연달아 적을 수 있게, 다시 그려도 열린 채로 둔다
const openSubAdd = new Set();
// 하위 단계를 추가한 직후, 다시 그린 입력 칸에 커서를 되돌려둘 단계 번호
let subToFocus = null;

// 서버에서 프로젝트 목록(진행률과 단계 포함)을 받아와서 화면을 다시 그린다.
// 오늘 탭의 할 일 줄이나 프로젝트 카드에서 할 일을 바꾼 뒤에도 이 함수로 새로고침한다
async function loadProjects() {
    const response = await fetch("/api/projects");
    if (!response.ok) {
        throw new Error("서버 오류: " + response.status);
    }
    projectsCache = await response.json();
    renderProjects();
    fillProjectSelect();
}

// 오늘 탭 입력줄의 프로젝트 선택 칸을 프로젝트 목록으로 채운다. 고르고 있던 프로젝트는 그대로 유지한다
function fillProjectSelect() {
    const previous = taskProjectSelect.value;
    taskProjectSelect.innerHTML = "";
    taskProjectSelect.add(new Option("프로젝트 없음", ""));
    projectsCache.forEach(function (project) {
        taskProjectSelect.add(new Option(project.name, project.id));
    });
    taskProjectSelect.value = previous;
    // 그 사이 지워진 프로젝트였다면 아무것도 선택되지 않은 상태가 되므로 "프로젝트 없음"으로 돌린다
    if (taskProjectSelect.value !== previous) {
        taskProjectSelect.value = "";
    }
}

// 마감일 글자와 급한지 여부를 만든다. 예: { text: "2026-12-31 (D-73)", urgent: false }
function describeDeadline(deadline) {
    const [year, month, day] = deadline.split("-").map(Number);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // 날짜끼리 빼면 밀리초가 나온다. 하루(86400000밀리초)로 나눠서 며칠 남았는지 센다
    const days = Math.round((new Date(year, month - 1, day) - todayStart) / 86400000);

    let remaining;
    if (days > 0) {
        remaining = "D-" + days;
    } else if (days === 0) {
        remaining = "오늘 마감";
    } else {
        remaining = (-days) + "일 지남";
    }
    // 마감이 7일 이내이거나 이미 지났으면 빨간색으로 강조한다.
    // short는 할 일 줄에 쓰는 짧은 글자다. 예: "11/18 (D-30)"
    return {
        text: deadline + " (" + remaining + ")",
        short: deadline.slice(5).replace("-", "/") + " (" + remaining + ")",
        urgent: days <= 7,
    };
}

// 프로젝트 카드 하나를 만든다
function makeProjectCard(project) {
    const card = document.createElement("div");
    card.className = "project-card";
    card.style.borderLeftColor = project.color;

    // 맨 윗줄: 이름, 마감일, 수정 버튼
    const head = document.createElement("div");
    head.className = "project-card-head";

    const name = document.createElement("span");
    name.className = "project-name";
    name.textContent = project.name;
    head.appendChild(name);

    if (project.deadline) {
        const deadline = describeDeadline(project.deadline);
        const deadlineText = document.createElement("span");
        deadlineText.className = "project-deadline" + (deadline.urgent ? " urgent" : "");
        deadlineText.textContent = deadline.text;
        head.appendChild(deadlineText);
    }

    const editButton = document.createElement("button");
    editButton.textContent = "수정";
    editButton.addEventListener("click", function () {
        openProjectDialog(project);
    });
    head.appendChild(editButton);
    card.appendChild(head);

    // 진행률 줄: progress bar와 퍼센트 글자.
    // progress bar는 바깥 상자(회색 바탕) 안에 안쪽 상자(색 채움)를 두고, 안쪽 상자의 width를 %로 정하면 된다
    const progressRow = document.createElement("div");
    progressRow.className = "progress-row";
    const bar = document.createElement("div");
    bar.className = "progress-bar";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    fill.style.width = project.percent + "%";
    fill.style.backgroundColor = project.color;
    bar.appendChild(fill);
    const percentText = document.createElement("span");
    percentText.className = "progress-text";
    percentText.textContent = project.percent + "%";
    progressRow.append(bar, percentText);
    card.appendChild(progressRow);

    // 진행률 설명 줄: 자동이면 "끝낸 단계 / 전체", 직접 입력이면 슬라이더
    const detail = document.createElement("div");
    detail.className = "progress-detail";
    if (project.progressMode === "manual") {
        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = 0;
        slider.max = 100;
        slider.step = 5;
        slider.value = project.manualPercent;
        // input: 끄는 동안 막대와 글자를 바로 바꾼다
        slider.addEventListener("input", function () {
            fill.style.width = slider.value + "%";
            percentText.textContent = slider.value + "%";
        });
        // change: 놓았을 때 한 번 저장한다
        slider.addEventListener("change", async function () {
            try {
                await sendRequest("/api/projects/" + project.id, "PATCH", { manualPercent: Number(slider.value) });
                project.manualPercent = Number(slider.value);
                project.percent = Number(slider.value);
            } catch (error) {
                showToast("진행률을 저장하지 못했습니다: " + error.message);
                await loadProjects();  // 저장에 실패했으면 서버에 있는 값으로 되돌린다
            }
        });
        detail.append("직접 입력 ", slider);
    } else {
        detail.textContent = "단계 " + project.doneCount + " / " + project.total + " 완료 (연결된 할 일 기준)";
    }
    card.appendChild(detail);

    // 단계 목록: 이 프로젝트에 연결된 단계들과, 각 단계 아래의 하위 단계들. 오늘 탭에서 연결한 할 일도 여기에 같이 나온다.
    // project.tasks는 위쪽 단계들의 리스트이고, 각 단계의 children에 하위 단계들이 들어 있다
    const today = toDateText(new Date());
    const stepList = document.createElement("ul");
    stepList.className = "today-list";

    // 단계 하나(또는 하위 단계 하나)의 줄 옵션. 오늘 하기 / 마감일 버튼은 단계와 하위 단계가 똑같이 쓴다
    function stepOptions(step, extra) {
        return Object.assign({
            reload: loadProjects,
            // 오늘 할 일이 아닌 단계에는 "오늘 하기" 버튼을 둔다. 누르면 날짜가 오늘이 되어 오늘 탭에 나타난다
            moveLabel: step.date === today ? null : "오늘 하기",
            moveDate: today,
            showDate: true,
            showProject: false,  // 카드 안이라서 프로젝트 이름표는 필요 없다
            editDeadline: true,
        }, extra);
    }

    project.tasks.forEach(function (step) {
        const children = step.children;
        const hasChildren = children.length > 0;
        const subAddOpen = openSubAdd.has(step.id);

        // "+ 하위" 버튼: 이 단계 아래에 하위 단계를 적는 입력 칸을 열고 닫는다
        const subToggle = document.createElement("button");
        subToggle.textContent = "+ 하위";
        subToggle.title = "이 단계 아래에 하위 단계 추가";
        subToggle.addEventListener("click", function () {
            if (subAddOpen) {
                openSubAdd.delete(step.id);
            } else {
                openSubAdd.add(step.id);
                subToFocus = step.id;
            }
            renderProjects();  // 서버에 다시 묻지 않고, 이미 받아둔 목록으로 화면만 다시 그린다
        });

        stepList.appendChild(makeTaskRow(step, stepOptions(step, {
            // 하위 단계가 있는 단계는 제목 역할이다. 체크와 오늘 하기는 그 아래 하위 단계들이 한다
            derived: hasChildren,
            moveLabel: hasChildren || step.date === today ? null : "오늘 하기",
            showDate: !hasChildren,
            countText: hasChildren
                ? children.filter(function (child) { return child.done === 1; }).length + "/" + children.length
                : null,
            extraButtons: [subToggle],
        })));

        if (hasChildren || subAddOpen) {
            // 하위 단계 묶음: 오른쪽으로 들여써서 상위 단계 아래에 놓는다
            const wrapper = document.createElement("li");
            wrapper.className = "sub-wrapper";
            const subList = document.createElement("ul");
            subList.className = "today-list";
            children.forEach(function (child) {
                subList.appendChild(makeTaskRow(child, stepOptions(child, {})));
            });
            wrapper.appendChild(subList);

            if (subAddOpen) {
                const sub = makeAddRow("하위 단계 추가하고 Enter", async function (content) {
                    // parentId를 보내면 서버가 같은 프로젝트의 하위 단계로 만든다
                    await sendRequest("/api/tasks", "POST", { content: content, parentId: step.id });
                    subToFocus = step.id;
                    await loadProjects();
                });
                wrapper.appendChild(sub.row);
                if (subToFocus === step.id) {
                    subToFocus = null;
                    setTimeout(function () {
                        sub.input.focus();
                    }, 0);
                }
            }
            stepList.appendChild(wrapper);
        }
    });
    card.appendChild(stepList);

    // 단계 추가 줄: 날짜 없는 할 일로 만들어진다. date는 보내지 않고, projectId로 이 프로젝트에 연결한다
    const stepAdd = makeAddRow("단계 추가하고 Enter", async function (content) {
        await sendRequest("/api/tasks", "POST", { content: content, projectId: project.id });
        projectToFocus = project.id;
        await loadProjects();
    });
    card.appendChild(stepAdd.row);
    if (projectToFocus === project.id) {
        projectToFocus = null;
        // 카드가 화면에 붙은 뒤에야 커서를 둘 수 있어서 한 박자 늦춘다
        setTimeout(function () {
            stepAdd.input.focus();
        }, 0);
    }

    return card;
}

// 입력 칸 + 추가 버튼이 있는 줄을 만든다. 글자를 쓰고 Enter(또는 버튼)를 누르면 onAdd(글자)를 실행한다.
// 단계 추가와 하위 단계 추가가 같이 쓴다. { row: 줄 전체, input: 입력 칸 }을 돌려준다
function makeAddRow(placeholder, onAdd) {
    const row = document.createElement("div");
    row.className = "task-add";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    const button = document.createElement("button");
    button.textContent = "추가";
    row.append(input, button);

    async function submit() {
        const content = input.value.trim();
        if (!content) {
            return;
        }
        try {
            await onAdd(content);
        } catch (error) {
            showToast("단계를 추가하지 못했습니다: " + error.message);
        }
    }
    button.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
        // 한글 조합 중의 Enter는 무시한다 (오늘 탭 입력칸과 같은 이유)
        if (e.key === "Enter" && !e.isComposing) {
            submit();
        }
    });
    return { row: row, input: input };
}

// 프로젝트 카드들을 모두 다시 그린다
function renderProjects() {
    projectListElement.innerHTML = "";
    if (projectsCache.length === 0) {
        const empty = document.createElement("p");
        empty.className = "today-empty";
        empty.textContent = "아직 프로젝트가 없습니다. 위의 '+ 새 프로젝트'로 만들어 보세요.";
        projectListElement.appendChild(empty);
        return;
    }
    projectsCache.forEach(function (project) {
        projectListElement.appendChild(makeProjectCard(project));
    });
}

// 프로젝트 추가/수정 창을 연다. project가 없으면 새 프로젝트
function openProjectDialog(project) {
    editingProject = project || null;
    projectDeleteArmed = false;
    projectDeleteButton.textContent = "삭제";
    projectDeleteButton.hidden = !editingProject;
    projectDialogTitle.textContent = editingProject ? "프로젝트 수정" : "새 프로젝트";

    projectNameInput.value = editingProject ? editingProject.name : "";
    projectDeadlineInput.value = editingProject && editingProject.deadline ? editingProject.deadline : "";
    projectColorInput.value = editingProject
        ? editingProject.color
        : PROJECT_COLORS[projectsCache.length % PROJECT_COLORS.length];
    // radio 칸 중 지금 방식에 해당하는 것을 체크한다. [value=...]는 value가 그 값인 요소를 찾는 선택자다
    const mode = editingProject ? editingProject.progressMode : "auto";
    document.querySelector('input[name="project-mode"][value="' + mode + '"]').checked = true;
    projectError.textContent = "";

    projectDialog.showModal();
    projectNameInput.focus();
}

// 프로젝트 창의 저장 버튼: 새 프로젝트면 POST, 수정이면 PATCH
async function saveProject() {
    const name = projectNameInput.value.trim();
    if (!name) {
        projectError.textContent = "이름을 입력하세요.";
        return;
    }

    const mode = document.querySelector('input[name="project-mode"]:checked').value;
    const body = {
        name: name,
        deadline: projectDeadlineInput.value,  // 비어 있으면 서버가 "마감일 없음"으로 저장한다
        color: projectColorInput.value,
        progressMode: mode,
    };
    // 자동 → 직접으로 바꾸면 슬라이더가 0%에서 시작하지 않고, 지금 보이던 진행률에서 시작하게 한다
    if (editingProject && mode === "manual" && editingProject.progressMode !== "manual") {
        body.manualPercent = editingProject.percent;
    }

    try {
        projectError.textContent = "저장하는 중...";
        if (editingProject) {
            await sendRequest("/api/projects/" + editingProject.id, "PATCH", body);
        } else {
            await sendRequest("/api/projects", "POST", body);
        }
        projectDialog.close();
        await loadProjects();
    } catch (error) {
        projectError.textContent = error.message;
    }
}

// 프로젝트 삭제: 일정, 할 일 삭제와 같이 두 번 눌러야 지워진다
async function deleteProject() {
    if (!projectDeleteArmed) {
        projectDeleteArmed = true;
        projectDeleteButton.textContent = "정말 삭제? (날짜 없는 단계도 함께 지워짐)";
        return;
    }
    try {
        await sendRequest("/api/projects/" + editingProject.id, "DELETE");
        projectDialog.close();
        await loadProjects();
    } catch (error) {
        projectError.textContent = error.message;
    }
}

projectAddButton.addEventListener("click", function () {
    openProjectDialog(null);
});
document.getElementById("project-save").addEventListener("click", saveProject);
document.getElementById("project-cancel").addEventListener("click", function () {
    projectDialog.close();
});
projectDeleteButton.addEventListener("click", deleteProject);
document.getElementById("project-deadline-clear").addEventListener("click", function () {
    projectDeadlineInput.value = "";
});
projectNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.isComposing) {
        saveProject();
    }
});

// ---------- 우선순위 탭 (Eisenhower Matrix) ----------
// 안 끝낸 할 일을 7×7 칸에 올려서 "얼마나 중요하고 얼마나 급한지"를 한눈에 본다.
// 가로가 긴급도, 세로가 중요도이고 둘 다 -3~3의 정수다. 가운데 줄(0)이 두 축이고, 그 줄이 네 구역(사분면)을 나눈다.
// 칸에 점을 찍는 대신 칸 안에 할 일 이름표(chip)를 담는다. 한 칸에 여러 개가 들어가면 그 칸의 키가 늘어나서 글자가 겹치지 않는다.
// 평가는 "끌어다 놓기"로 한다: 오른쪽 목록 → 칸(평가), 칸 → 다른 칸(고치기), 칸 → 오른쪽 목록(평가 취소).
// 할 일을 한 번 클릭하면 작은 메뉴가 떠서 "완료"하거나 "매트릭스에서 빼기"(평가 취소)를 할 수 있다.

const matrixElement = document.getElementById("matrix");
const unrankedPanel = document.getElementById("priority-unranked");
const unrankedList = document.getElementById("priority-unranked-list");
const unrankedCount = document.getElementById("priority-unranked-count");

const PRIORITY_RANGE = 3;          // 평가 범위는 -3 ~ 3 (서버의 PRIORITY_LIMIT과 같아야 한다)
const PRIORITY_DRAG_THRESHOLD = 4; // 이 거리(px)보다 적게 움직이면 끌기가 아니라 클릭으로 본다

let priorityTasks = [];  // 서버에서 받은 안 끝낸 할 일 전부 (평가한 것과 안 한 것이 섞여 있다)
const matrixCells = {};  // "긴급도,중요도" → 그 칸의 요소. 예: matrixCells["3,-2"]

// 7×7 칸을 한 번만 만든다. 위에서 아래로 중요도 3 → -3, 왼쪽에서 오른쪽으로 긴급도 -3 → 3
function buildMatrix() {
    for (let importance = PRIORITY_RANGE; importance >= -PRIORITY_RANGE; importance--) {
        // 줄 왼쪽의 중요도 숫자
        const rowLabel = document.createElement("div");
        rowLabel.className = "matrix-label" + (importance === 0 ? " zero" : "");
        rowLabel.textContent = importance;
        matrixElement.appendChild(rowLabel);

        for (let urgency = -PRIORITY_RANGE; urgency <= PRIORITY_RANGE; urgency++) {
            const cell = document.createElement("div");
            cell.className = "matrix-cell";
            cell.dataset.urgency = urgency;
            cell.dataset.importance = importance;
            if (urgency === 0 || importance === 0) {
                cell.classList.add("axis");  // 가운데 줄(축)
            } else if (importance > 0) {
                cell.classList.add(urgency > 0 ? "q-now" : "q-plan");
            } else {
                cell.classList.add(urgency > 0 ? "q-quick" : "q-drop");
            }
            matrixCells[urgency + "," + importance] = cell;
            matrixElement.appendChild(cell);
        }
    }
    // 칸들 아래의 긴급도 숫자 줄 (왼쪽 첫 칸은 줄 숫자 칸과 맞추려고 비워 둔다)
    const colLabels = document.getElementById("matrix-col-labels");
    colLabels.appendChild(document.createElement("div"));
    for (let urgency = -PRIORITY_RANGE; urgency <= PRIORITY_RANGE; urgency++) {
        const colLabel = document.createElement("div");
        colLabel.className = "matrix-label" + (urgency === 0 ? " zero" : "");
        colLabel.textContent = urgency;
        colLabels.appendChild(colLabel);
    }
}

// 할 일 하나의 이름표를 만든다. variant가 "chip"이면 칸 안의 작은 것, "row"이면 오른쪽 목록의 한 줄이다
function makePriorityItem(task, variant) {
    const item = document.createElement("div");
    item.className = "priority-item " + variant;
    item.dataset.taskId = task.id;

    // 프로젝트 색 동그라미 (프로젝트가 없으면 속이 빈 회색 고리)
    const dot = document.createElement("span");
    dot.className = "priority-dot";
    if (task.project_color) {
        dot.style.backgroundColor = task.project_color;
    } else {
        dot.classList.add("none");
    }

    const name = document.createElement("span");
    name.className = "priority-name";
    name.textContent = task.content;
    item.append(dot, name);

    // 마감일이 있으면 긴급도를 정할 때 참고할 수 있게 보여준다. 3일 이내(지난 것 포함)는 빨갛게.
    // 목록 줄에는 D-숫자를 붙이고, 칸 안의 이름표는 자리가 좁으니 빨간 테두리로만 알리고 자세한 것은 툴팁에 둔다
    let deadlineText = "";
    if (task.deadline) {
        const days = daysUntil(task.deadline);
        const soon = days <= 3;
        if (variant === "row") {
            const deadline = document.createElement("span");
            deadline.className = "priority-deadline" + (soon ? " soon" : "");
            deadline.textContent = ddayLabel(days);
            item.appendChild(deadline);
        } else if (soon) {
            item.classList.add("soon");
        }
        deadlineText = "\n마감 " + task.deadline + " (" + ddayLabel(days) + ")";
    }

    if (variant === "row" && task.project_name) {
        // 목록 줄에는 어느 프로젝트의 어느 단계인지도 작게 보여준다
        const sub = document.createElement("span");
        sub.className = "priority-sub";
        sub.textContent = task.project_name + (task.parent_content ? " › " + task.parent_content : "");
        item.appendChild(sub);
    }

    // 마우스를 올리면 전체 이름과 현재 평가가 보인다 (칸 안에서는 이름이 줄여져 보이므로)
    const rating = task.importance === null ? "" : "\n중요 " + task.importance + " · 긴급 " + task.urgency;
    item.title = task.content + (task.project_name ? "\n" + task.project_name : "") + deadlineText + rating;

    item.addEventListener("pointerdown", function (e) {
        beginPriorityDrag(e, item, task);
    });
    return item;
}

// 칸과 오른쪽 목록을 현재 priorityTasks에 맞춰 다시 채운다
function renderPriority() {
    Object.values(matrixCells).forEach(function (cell) {
        cell.replaceChildren();
    });
    unrankedList.replaceChildren();

    const unranked = [];
    priorityTasks.forEach(function (task) {
        if (task.importance === null || task.urgency === null) {
            unranked.push(task);
        } else {
            matrixCells[task.urgency + "," + task.importance].appendChild(makePriorityItem(task, "chip"));
        }
    });

    // 마감일이 가까운 것이 위로. 마감일이 없는 것은 뒤로, 같으면 만든 순서
    unranked.sort(function (a, b) {
        if (a.deadline && b.deadline && a.deadline !== b.deadline) {
            return a.deadline < b.deadline ? -1 : 1;
        }
        if (Boolean(a.deadline) !== Boolean(b.deadline)) {
            return a.deadline ? -1 : 1;
        }
        return a.id - b.id;
    });
    unranked.forEach(function (task) {
        unrankedList.appendChild(makePriorityItem(task, "row"));
    });
    unrankedCount.textContent = unranked.length > 0 ? unranked.length + "개" : "";

    if (unranked.length === 0) {
        const empty = document.createElement("p");
        empty.className = "priority-empty";
        empty.textContent = priorityTasks.length === 0
            ? "끝내지 않은 할 일이 없어요."
            : "모든 할 일을 평가했어요.";
        unrankedList.appendChild(empty);
    }
}

async function loadPriority() {
    const response = await fetch("/api/priority-tasks");
    if (!response.ok) {
        throw new Error(await errorMessageFrom(response));
    }
    priorityTasks = await response.json();
    renderPriority();
}

// 평가를 바꾼다 (importance, urgency가 둘 다 null이면 평가 취소). 화면에는 먼저 반영하고, 저장에 실패하면 서버 값으로 되돌린다
async function setPriority(task, importance, urgency) {
    task.importance = importance;
    task.urgency = urgency;
    renderPriority();
    try {
        await sendRequest("/api/tasks/" + task.id, "PATCH", { importance: importance, urgency: urgency });
    } catch (error) {
        showToast("평가를 저장하지 못했습니다: " + error.message);
        loadPriority().catch(function () {});
    }
}

// ----- 끌어다 놓기 -----
// 포인터 이벤트로 직접 만든다(타이머 위젯을 옮길 때와 같은 방식, 새 라이브러리 없음).
// 끄는 동안 원래 이름표는 흐리게 남고, 마우스를 따라다니는 복사본(ghost)을 보여준다

let priorityDrag = null;  // 끄는 중에만 값이 있다: { task, item, startX, startY, grabX, grabY, ghost, hover }

function beginPriorityDrag(e, item, task) {
    if (e.pointerType === "mouse" && e.button !== 0) {
        return;
    }
    const rect = item.getBoundingClientRect();
    priorityDrag = {
        task: task, item: item, startX: e.clientX, startY: e.clientY,
        grabX: e.clientX - rect.left, grabY: e.clientY - rect.top, ghost: null, hover: null,
    };
    // 마우스가 이름표 밖으로 나가도 계속 이 이름표가 이벤트를 받게 한다
    item.setPointerCapture(e.pointerId);
    item.addEventListener("pointermove", movePriorityDrag);
    item.addEventListener("pointerup", endPriorityDrag);
    item.addEventListener("pointercancel", cancelPriorityDrag);
}

// 마우스 아래에 있는 놓을 자리를 찾는다: 칸, 오른쪽 목록, 아니면 null. (ghost는 pointer-events: none이라 아래가 보인다)
function priorityDropTarget(x, y) {
    const element = document.elementFromPoint(x, y);
    if (!element) {
        return null;
    }
    const cell = element.closest(".matrix-cell");
    if (cell) {
        return cell;
    }
    return element.closest("#priority-unranked");
}

function movePriorityDrag(e) {
    const drag = priorityDrag;
    if (!drag) {
        return;
    }
    if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < PRIORITY_DRAG_THRESHOLD) {
            return;
        }
        drag.ghost = drag.item.cloneNode(true);
        drag.ghost.classList.add("priority-ghost");
        drag.ghost.style.width = drag.item.offsetWidth + "px";
        document.body.appendChild(drag.ghost);
        drag.item.classList.add("drag-source");
        document.body.classList.add("priority-dragging");
    }
    drag.ghost.style.left = (e.clientX - drag.grabX) + "px";
    drag.ghost.style.top = (e.clientY - drag.grabY) + "px";

    // 놓을 수 있는 자리를 강조한다
    const target = priorityDropTarget(e.clientX, e.clientY);
    if (target !== drag.hover) {
        if (drag.hover) {
            drag.hover.classList.remove("drop-hover");
        }
        if (target) {
            target.classList.add("drop-hover");
        }
        drag.hover = target;
    }

    // 화면 위나 아래 끝 근처로 가면 페이지를 스크롤한다 (키가 큰 칸 때문에 아래쪽 줄이 화면 밖일 수 있다)
    if (e.clientY < 50) {
        window.scrollBy(0, -14);
    } else if (e.clientY > window.innerHeight - 50) {
        window.scrollBy(0, 14);
    }
}

// 끌기를 마무리한다. 놓은 자리가 있으면 그 자리로 평가를 바꾼다
function finishPriorityDrag(e, drop) {
    const drag = priorityDrag;
    if (!drag) {
        return;
    }
    priorityDrag = null;
    drag.item.removeEventListener("pointermove", movePriorityDrag);
    drag.item.removeEventListener("pointerup", endPriorityDrag);
    drag.item.removeEventListener("pointercancel", cancelPriorityDrag);
    document.body.classList.remove("priority-dragging");
    drag.item.classList.remove("drag-source");
    if (drag.hover) {
        drag.hover.classList.remove("drop-hover");
    }
    if (!drag.ghost) {
        // 거의 안 움직였다 = 그냥 클릭 → 메뉴를 띄운다. 단, 이미 이 할 일의 메뉴가 떠 있다가 이번 누름으로 닫혔다면 다시 열지 않는다(한 번 더 클릭하면 닫히는 느낌)
        if (drop && priorityMenuClosedFor !== drag.task.id) {
            openPriorityMenu(drag.item, drag.task);
        }
        return;
    }
    drag.ghost.remove();
    if (!drop) {
        return;
    }

    const target = priorityDropTarget(e.clientX, e.clientY);
    const task = drag.task;
    if (target && target.classList.contains("matrix-cell")) {
        const urgency = Number(target.dataset.urgency);
        const importance = Number(target.dataset.importance);
        if (task.urgency !== urgency || task.importance !== importance) {
            setPriority(task, importance, urgency);
        }
    } else if (target === unrankedPanel && task.importance !== null) {
        setPriority(task, null, null);
    }
}

function endPriorityDrag(e) {
    finishPriorityDrag(e, true);
}

function cancelPriorityDrag(e) {
    finishPriorityDrag(e, false);
}

// ----- 클릭 메뉴 -----
// 할 일을 한 번 클릭하면 그 옆에 뜨는 작은 메뉴. "완료"는 어느 쪽(칸/목록)에서든, "매트릭스에서 빼기"는 칸 안의 것에만 있다.
// 빼기는 할 일을 지우는 것이 아니라 평가만 취소해서 오른쪽 목록으로 돌려보낸다.

let priorityMenu = null;            // 떠 있는 메뉴 요소 (없으면 null)
let priorityMenuTaskId = null;      // 떠 있는 메뉴가 어느 할 일의 것인지
let priorityMenuClosedFor = null;   // 방금 누름으로 닫힌 메뉴의 할 일 번호. 같은 할 일을 다시 클릭했을 때 되열리는 것을 막는 데 쓴다

function closePriorityMenu() {
    if (priorityMenu) {
        priorityMenu.remove();
        priorityMenu = null;
        priorityMenuTaskId = null;
    }
}

function openPriorityMenu(item, task) {
    closePriorityMenu();
    const menu = document.createElement("div");
    menu.className = "priority-menu";

    const title = document.createElement("div");
    title.className = "priority-menu-title";
    title.textContent = task.content;
    menu.appendChild(title);

    const doneButton = document.createElement("button");
    doneButton.textContent = "✓ 완료";
    doneButton.addEventListener("click", function () {
        closePriorityMenu();
        completePriorityTask(task);
    });
    menu.appendChild(doneButton);

    if (task.importance !== null) {
        const removeButton = document.createElement("button");
        removeButton.textContent = "↩ 매트릭스에서 빼기";
        removeButton.addEventListener("click", function () {
            closePriorityMenu();
            setPriority(task, null, null);
        });
        menu.appendChild(removeButton);
    }

    document.body.appendChild(menu);
    priorityMenu = menu;
    priorityMenuTaskId = task.id;

    // 이름표 바로 아래에 띄우되, 화면 밖으로 나가면 위로/안쪽으로 옮긴다
    const rect = item.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - width - 8);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - height - 6);
    }
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = top + "px";
}

// 할 일을 끝낸다: 화면에서 먼저 치우고 서버에 저장한다. 실패하면 서버 값으로 되돌린다
async function completePriorityTask(task) {
    priorityTasks = priorityTasks.filter(function (t) {
        return t !== task;
    });
    renderPriority();
    try {
        await sendRequest("/api/tasks/" + task.id, "PATCH", { done: true });
        showToast("완료했어요: " + task.content);
    } catch (error) {
        showToast("완료하지 못했습니다: " + error.message);
        loadPriority().catch(function () {});
    }
}

// 메뉴 밖을 누르면 닫는다. capture(true)로 다른 곳의 이벤트보다 먼저 받아서, 메뉴가 열려 있었는지 기억해 둔다
document.addEventListener("pointerdown", function (e) {
    priorityMenuClosedFor = null;
    if (priorityMenu && !priorityMenu.contains(e.target)) {
        priorityMenuClosedFor = priorityMenuTaskId;
        closePriorityMenu();
    }
}, true);

document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
        closePriorityMenu();
    }
});

// 스크롤하거나 창 크기가 바뀌면 메뉴 위치가 어긋나니 닫는다
window.addEventListener("scroll", closePriorityMenu);
window.addEventListener("resize", closePriorityMenu);

buildMatrix();

// ---------- 노트 탭 (Obsidian vault) ----------
// 설정 탭에 적은 Obsidian vault 폴더의 .md 노트를 StudyFlow 안에서 보고 고친다. 고친 내용은 vault의 파일에 바로 저장되어 Obsidian에서도 보인다.
// 노트는 사용자의 원본 데이터라서 서버(notes_store.py)가 경로 검사, 안전한 저장, 충돌 감지, 백업을 맡고, 이 코드는 화면과 "언제 저장하나"를 맡는다.
//  - 읽기 모드: 마크다운을 서식대로 보여준다 (marked가 HTML로 바꾸고, DOMPurify가 위험한 부분을 걸러낸다)
//  - 편집 모드: 글자를 그대로 고친다. 입력을 멈추고 1초 뒤(또는 Ctrl+S, 다른 노트/탭으로 이동할 때) 자동 저장한다
//  - Obsidian에서 같은 노트가 바뀌면 4초 안에 알아채고, 내가 고치는 중이 아니면 새 내용을 불러온다. 고치는 중이면 어느 쪽을 쓸지 물어본다

const notesLayout = document.getElementById("notes-layout");
const notesUnconfigured = document.getElementById("notes-unconfigured");
const notesUnconfiguredText = document.getElementById("notes-unconfigured-text");
const notesTree = document.getElementById("notes-tree");
const notesCount = document.getElementById("notes-count");
const notesSearch = document.getElementById("notes-search");
const notesEmpty = document.getElementById("notes-empty");
const notesEditor = document.getElementById("notes-editor");
const notesTitle = document.getElementById("notes-title");
const notesStatus = document.getElementById("notes-status");
const notesRead = document.getElementById("notes-read");
const notesText = document.getElementById("notes-text");
const notesModeRead = document.getElementById("notes-mode-read");
const notesModeEdit = document.getElementById("notes-mode-edit");
const notesConflict = document.getElementById("notes-conflict");
const notesConflictText = document.getElementById("notes-conflict-text");
const noteDialog = document.getElementById("note-dialog");
const noteNameInput = document.getElementById("note-name");
const noteErrorElement = document.getElementById("note-error");
const vaultPathInput = document.getElementById("vault-path-input");
const vaultPathStatus = document.getElementById("vault-path-status");

const NOTE_SAVE_DELAY_MS = 1000;   // 입력을 멈추고 이만큼 지나면 자동 저장
const NOTE_POLL_INTERVAL_MS = 4000; // 열어 둔 노트가 밖에서 바뀌었는지 확인하는 간격

let notesList = [];               // 서버가 알려준 노트 목록 [{path, mtime}]
let notesQuery = "";              // 검색칸에 적힌 글자
const openFolders = new Set();    // 펼쳐 둔 폴더들의 경로

// 지금 열어 둔 노트의 상태. 글자 자체는 편집 칸(notesText)이 갖고 있고, 읽기 모드는 거기서 읽어서 그린다
const note = {
    path: null,        // vault 안의 상대 경로 "폴더/이름.md" (안 열었으면 null)
    mtime: null,       // 노트를 읽거나 저장했을 때 서버가 알려준 수정 시각. 저장할 때 서버가 "그 사이에 안 바뀌었나?" 확인하는 데 쓴다
    diskMtime: null,   // 충돌이 났을 때 지금 파일의 수정 시각
    mode: "read",      // "read" 또는 "edit"
    dirty: false,      // 아직 저장 안 한 수정이 있는지
    saving: false,     // 저장 요청이 진행 중인지
    saveAgain: false,  // 저장 중에 또 고쳐서, 끝나면 한 번 더 저장해야 하는지
    conflict: false,   // 밖에서 바뀌어서 저장을 멈춘 상태인지
    saveTimer: null,
};

// 서버에 요청을 보내고 JSON 답을 돌려준다. 실패하면 이유를 담은 Error를 던지고, error.status에 응답 번호를 달아 둔다
async function notesRequest(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        const error = new Error(await errorMessageFrom(response));
        error.status = response.status;
        throw error;
    }
    return response.json();
}

function noteUrl(base, path) {
    return base + "?path=" + encodeURIComponent(path);
}

function isNotesTabActive() {
    return document.getElementById("notes").classList.contains("active");
}

function setNoteStatus(text, isError) {
    notesStatus.textContent = text;
    notesStatus.classList.toggle("error", Boolean(isError));
}

// ----- 노트 목록 (왼쪽) -----

// "폴더/하위/이름.md" → "이름"
function noteDisplayName(path) {
    return path.split("/").pop().replace(/\.md$/i, "");
}

// 서버에서 노트 목록을 받아 온다. vault를 안 정했거나 폴더를 못 찾으면 안내를 보여주고 { configured:false } 모양을 돌려준다
async function loadNotesList() {
    const data = await notesRequest("/api/notes");
    const usable = data.configured && !data.error;
    notesLayout.hidden = !usable;
    notesUnconfigured.hidden = usable;
    if (!usable) {
        notesUnconfiguredText.textContent = data.error
            ? data.error
            : "Obsidian vault 폴더가 아직 정해지지 않았습니다. 설정 탭에서 폴더 경로를 적어 주세요.";
        notesList = [];
        return data;
    }
    notesList = data.notes;
    notesCount.textContent = "노트 " + notesList.length + "개" + (data.truncated ? " (일부만 표시)" : "");
    renderNotesTree();
    return data;
}

// 목록을 "폴더 › 하위 폴더 › 노트" 모양의 나무로 묶는다
function buildNoteTree(list) {
    const root = { folders: new Map(), files: [] };
    list.forEach(function (item) {
        const parts = item.path.split("/");
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!node.folders.has(parts[i])) {
                node.folders.set(parts[i], { folders: new Map(), files: [] });
            }
            node = node.folders.get(parts[i]);
        }
        node.files.push({ name: parts[parts.length - 1], path: item.path });
    });
    return root;
}

function makeNoteItem(path, label, folderLabel) {
    const button = document.createElement("button");
    button.className = "note-item" + (path === note.path ? " active" : "");
    button.title = path;
    button.textContent = label;
    if (folderLabel) {
        const folder = document.createElement("span");
        folder.className = "note-item-folder";
        folder.textContent = folderLabel;
        button.appendChild(folder);
    }
    button.addEventListener("click", function () {
        openNote(path);
    });
    return button;
}

// 이름 비교 규칙: 한국어 정렬 순서이고, 숫자는 크기 순서로 비교한다 ("노트 2"가 "노트 10"보다 앞)
const noteNameCollator = new Intl.Collator("ko", { numeric: true });
const compareKorean = function (a, b) {
    return noteNameCollator.compare(a, b);
};

function renderNoteFolder(node, container, prefix) {
    // 폴더가 먼저, 그다음 노트. 각각 이름순
    Array.from(node.folders.keys()).sort(compareKorean).forEach(function (name) {
        const path = prefix + name;
        const details = document.createElement("details");  // 접었다 펴는 줄을 만드는 기본 HTML 태그
        details.className = "note-folder";
        details.open = openFolders.has(path);
        const summary = document.createElement("summary");
        summary.textContent = name;
        const children = document.createElement("div");
        children.className = "note-folder-children";
        details.append(summary, children);
        details.addEventListener("toggle", function () {
            if (details.open) {
                openFolders.add(path);
            } else {
                openFolders.delete(path);
            }
        });
        renderNoteFolder(node.folders.get(name), children, path + "/");
        container.appendChild(details);
    });
    node.files.sort(function (a, b) {
        return compareKorean(a.name, b.name);
    }).forEach(function (file) {
        container.appendChild(makeNoteItem(file.path, noteDisplayName(file.path)));
    });
}

function renderNotesTree() {
    notesTree.replaceChildren();
    const query = notesQuery.trim().toLowerCase();
    if (query) {
        // 검색 중에는 폴더 구조 대신 맞는 노트만 평평하게 보여준다 (폴더 이름은 노트 이름 옆에 작게)
        const found = notesList.filter(function (item) {
            return item.path.toLowerCase().includes(query);
        });
        found.forEach(function (item) {
            const folder = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
            notesTree.appendChild(makeNoteItem(item.path, noteDisplayName(item.path), folder));
        });
        if (found.length === 0) {
            notesTree.appendChild(makeNotesHint("찾는 노트가 없어요."));
        }
        return;
    }
    if (notesList.length === 0) {
        notesTree.appendChild(makeNotesHint("노트가 없어요. ＋ 버튼으로 만들어 보세요."));
        return;
    }
    renderNoteFolder(buildNoteTree(notesList), notesTree, "");
}

function makeNotesHint(text) {
    const p = document.createElement("p");
    p.className = "notes-hint";
    p.textContent = text;
    return p;
}

notesSearch.addEventListener("input", function () {
    notesQuery = notesSearch.value;
    renderNotesTree();
});

document.getElementById("notes-refresh").addEventListener("click", function () {
    loadNotesList().catch(function (error) {
        showToast("노트 목록을 불러오지 못했습니다: " + error.message);
    });
});

document.getElementById("notes-open-settings").addEventListener("click", function () {
    document.querySelector("[data-tab=settings]").click();
});

// ----- 노트 열기 / 읽기 / 편집 -----

function showReadOrEdit() {
    notesModeRead.classList.toggle("active", note.mode === "read");
    notesModeEdit.classList.toggle("active", note.mode === "edit");
    notesRead.hidden = note.mode !== "read";
    notesText.hidden = note.mode !== "edit";
    if (note.mode === "read") {
        renderNoteMarkdown();
    } else {
        notesText.focus({ preventScroll: true });
    }
}

async function setNoteMode(mode) {
    note.mode = mode;
    showReadOrEdit();
}

notesModeRead.addEventListener("click", function () {
    setNoteMode("read");
});
notesModeEdit.addEventListener("click", function () {
    setNoteMode("edit");
});

function showNoteTitle(path) {
    notesTitle.replaceChildren();
    if (path.includes("/")) {
        const folder = document.createElement("span");
        folder.className = "notes-title-folder";
        folder.textContent = path.slice(0, path.lastIndexOf("/")).split("/").join(" › ") + " › ";
        notesTitle.appendChild(folder);
    }
    notesTitle.append(noteDisplayName(path));
    notesTitle.title = path;
}

function hideConflict() {
    note.conflict = false;
    notesConflict.hidden = true;
}

// 서버에서 노트 내용을 받아 편집 칸과 상태에 넣는다 (아직 저장 안 한 수정은 버려진다)
async function loadNoteFromDisk(path) {
    const data = await notesRequest(noteUrl("/api/notes/content", path));
    note.path = path;
    note.mtime = data.mtime;
    notesText.value = data.content;
    note.dirty = false;
    hideConflict();
    return data;
}

// 노트를 연다. options.edit가 true면 바로 편집 모드로 (새 노트용). 열기 전에 지금 노트의 수정을 먼저 저장한다
async function openNote(path, options) {
    options = options || {};
    await flushNote();
    try {
        await loadNoteFromDisk(path);
    } catch (error) {
        showToast("노트를 열지 못했습니다: " + error.message);
        if (error.status === 404) {
            loadNotesList().catch(function () {});  // 지워졌거나 이름이 바뀐 노트가 목록에 남아 있을 수 있다
        }
        return;
    }
    notesEmpty.hidden = true;
    notesEditor.hidden = false;
    showNoteTitle(path);
    setNoteStatus("");
    note.mode = options.edit ? "edit" : "read";
    showReadOrEdit();
    notesRead.scrollTop = 0;

    // 열어 둔 노트가 들어 있는 폴더들을 펼치고 목록에서 강조한다
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
        openFolders.add(parts.slice(0, i).join("/"));
    }
    renderNotesTree();

    // 다음에 노트 탭을 열 때 이 노트가 열려 있도록 기억한다
    await settingsReady;
    if (settings.lastNote !== path) {
        settings.lastNote = path;
        saveSettings();
    }
}

// ----- 마크다운을 읽기 모드로 보여주기 -----

// 노트 맨 위의 속성 영역(--- 로 둘러싸인 부분)을 본문과 나눈다
function splitFrontmatter(text) {
    const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
    return match ? { front: match[1], body: text.slice(match[0].length) } : { front: null, body: text };
}

// 노트 이름(또는 "폴더/이름")으로 노트를 찾는다. Obsidian의 [[링크]]가 가리키는 노트를 찾는 데 쓴다
function findNoteByName(name) {
    const wanted = name.trim().toLowerCase();
    const found = notesList.find(function (item) {
        const path = item.path.toLowerCase();
        return path === wanted + ".md" || path === wanted || noteDisplayName(path) === wanted;
    });
    return found ? found.path : null;
}

// 읽기 화면에서 [[노트 이름]] 또는 [[노트 이름|보일 글자]]를 링크로 바꾼다. 코드 안이나 이미 링크인 곳은 건드리지 않는다
function linkWikilinks(root) {
    const pattern = /\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|([^\[\]\n]+))?\]\]/g;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets = [];
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement.closest("code, pre, a") && pattern.test(node.nodeValue)) {
            targets.push(node);
        }
        pattern.lastIndex = 0;
    }
    targets.forEach(function (node) {
        const fragment = document.createDocumentFragment();
        const text = node.nodeValue;
        let last = 0;
        text.replace(pattern, function (whole, target, alias, offset) {
            fragment.append(text.slice(last, offset));
            const link = document.createElement("a");
            link.className = "wikilink";
            link.textContent = (alias || target).trim();
            const path = findNoteByName(target);
            if (path) {
                link.dataset.path = path;
                link.href = "#";
            } else {
                link.classList.add("missing");
                link.title = "이 이름의 노트를 찾을 수 없어요";
            }
            fragment.append(link);
            last = offset + whole.length;
            return whole;
        });
        fragment.append(text.slice(last));
        node.replaceWith(fragment);
    });
}

// Obsidian의 형광펜 문법 ==글자== 를 <mark>글자</mark>로 바꾸는 규칙을 marked에 더한다 (표준 마크다운에는 없는 문법이다).
// 안쪽의 굵게/기울임/링크도 그대로 처리된다. 여는 == 바로 뒤는 공백이나 =가 아니어야 해서 "a == b == c" 같은 비교식이나 "===세 개==="는
// 형광펜으로 오해하지 않는다. 닫는 == 앞의 공백은 봐준다("==글자 ==" 처럼 실수로 띄어 쓴 경우가 실제 노트에 있었다). 닫는 ==가 없으면 그냥 글자다.
// 코드(`...`, ``` 블록) 안에서는 marked가 이 규칙까지 오지 않는다
if (typeof marked !== "undefined") {
    marked.use({
        extensions: [{
            name: "highlight",
            level: "inline",
            start: function (src) {
                return src.indexOf("==");
            },
            tokenizer: function (src) {
                const match = /^==(?![=\s])([^\n]*?[^=])==(?!=)/.exec(src);
                if (match) {
                    const inner = match[1].trimEnd();  // 닫는 == 앞의 공백은 형광펜에 넣지 않는다
                    return { type: "highlight", raw: match[0], text: inner, tokens: this.lexer.inlineTokens(inner) };
                }
            },
            renderer: function (token) {
                return "<mark>" + this.parser.parseInline(token.tokens) + "</mark>";
            },
        }],
    });
}

function renderNoteMarkdown() {
    notesRead.replaceChildren();
    const parts = splitFrontmatter(notesText.value);

    if (parts.front !== null) {
        const details = document.createElement("details");
        details.className = "note-properties";
        const summary = document.createElement("summary");
        summary.textContent = "속성";
        const pre = document.createElement("pre");
        pre.textContent = parts.front;
        details.append(summary, pre);
        notesRead.appendChild(details);
    }

    const body = document.createElement("div");
    if (typeof marked === "undefined" || typeof DOMPurify === "undefined") {
        // 라이브러리를 못 불러왔을 때는 서식 없이 글자 그대로 보여준다
        body.className = "note-plain";
        body.textContent = parts.body;
    } else {
        // breaks: true → 줄바꿈 한 번도 줄바꿈으로 (Obsidian의 기본 모양과 같다). sanitize: 스크립트 같은 위험한 부분을 지운다
        body.innerHTML = DOMPurify.sanitize(marked.parse(parts.body, { gfm: true, breaks: true }));
        linkWikilinks(body);
    }
    notesRead.appendChild(body);
}

// 읽기 화면의 링크: [[노트 링크]]는 그 노트를 열고, 웹 주소는 컴퓨터의 기본 브라우저로 연다.
// 이 창 안에서 이동해 버리면 StudyFlow 화면이 사라지므로 모든 링크의 기본 동작을 막는다
notesRead.addEventListener("click", function (e) {
    const link = e.target.closest("a");
    if (!link) {
        return;
    }
    e.preventDefault();
    if (link.dataset.path) {
        openNote(link.dataset.path);
        return;
    }
    const href = link.getAttribute("href") || "";
    if (/^https?:\/\//i.test(href)) {
        notesRequest("/api/open-external", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: href }),
        }).catch(function (error) {
            showToast("링크를 열지 못했습니다: " + error.message);
        });
    }
});

// ----- 저장 -----

// 노트를 저장한다. keepalive가 true면 창이 닫히는 중에도 요청이 끝까지 가도록 한다
async function saveNote(keepalive) {
    clearTimeout(note.saveTimer);
    if (!note.path || !note.dirty || note.conflict) {
        return;
    }
    if (note.saving) {
        note.saveAgain = true;  // 지금 저장이 끝나면 그 사이의 수정을 한 번 더 저장한다
        return;
    }
    note.saving = true;
    setNoteStatus("저장 중…");
    const path = note.path;
    const content = notesText.value;
    try {
        const response = await fetch("/api/notes/content", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: path, content: content, baseMtime: note.mtime }),
            keepalive: Boolean(keepalive),
        });
        if (response.status === 409) {
            // 읽은 뒤에 파일이 다른 곳에서 바뀌었다. 덮어쓰지 않고 사용자에게 묻는다
            const body = await response.json();
            showConflict(body.mtime);
            return;
        }
        if (!response.ok) {
            throw new Error(await errorMessageFrom(response));
        }
        const data = await response.json();
        if (note.path === path) {
            note.mtime = data.mtime;
            if (notesText.value === content) {
                note.dirty = false;
                setNoteStatus("저장됨");
            } else {
                note.saveAgain = true;  // 저장하는 사이에 더 고쳤다
            }
        }
    } catch (error) {
        setNoteStatus("저장 실패", true);
        showToast("노트를 저장하지 못했습니다: " + error.message);
        note.saveTimer = setTimeout(saveNote, 5000);  // 5초 뒤 다시 시도한다
    } finally {
        note.saving = false;
        if (note.saveAgain) {
            note.saveAgain = false;
            saveNote();
        }
    }
}

// 아직 저장 안 한 수정이 있으면 저장하고, 진행 중인 저장이 끝날 때까지 기다린다. 노트나 탭을 옮기기 전에 부른다
async function flushNote() {
    clearTimeout(note.saveTimer);
    if (note.dirty && !note.conflict) {
        await saveNote();
    }
    while (note.saving) {
        await new Promise(function (resolve) {
            setTimeout(resolve, 50);
        });
    }
}

notesText.addEventListener("input", function () {
    note.dirty = true;
    if (!note.conflict) {
        setNoteStatus("수정 중…");
        clearTimeout(note.saveTimer);
        note.saveTimer = setTimeout(saveNote, NOTE_SAVE_DELAY_MS);
    }
});

// Ctrl+S: 기다리지 않고 바로 저장
notesText.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        flushNote();
    }
});

// 창이 가려지거나 닫히기 직전에 저장 안 된 수정이 있으면 서둘러 저장한다.
// 반대로 최소화했던 창이 다시 보이면, 그 사이에 Obsidian에서 바뀐 것이 있는지 4초를 기다리지 않고 바로 확인한다
// (창이 가려져 있는 동안은 pollNote가 일부러 확인을 건너뛴다)
document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
        if (note.dirty) {
            saveNote(true);
        }
    } else {
        pollNote();
    }
});
window.addEventListener("pagehide", function () {
    if (note.dirty) {
        saveNote(true);
    }
});

// ----- Obsidian에서 바뀐 것 알아채기 / 충돌 -----

function showConflict(diskMtime) {
    note.conflict = true;
    note.diskMtime = diskMtime;
    clearTimeout(note.saveTimer);
    notesConflictText.textContent = note.dirty
        ? "이 노트가 Obsidian(또는 다른 곳)에서도 바뀌었어요. 내가 고친 내용과 합칠 수 없어서 저장을 멈췄어요."
        : "이 노트가 Obsidian(또는 다른 곳)에서 바뀌었어요.";
    notesConflict.hidden = false;
    setNoteStatus("저장 안 됨", true);
}

document.getElementById("notes-conflict-overwrite").addEventListener("click", function () {
    // 지금 파일의 수정 시각을 기준으로 삼아서, 내 내용으로 덮어쓴다 (덮어쓰기 직전의 파일은 notes_backup에 복사돼 있다)
    note.mtime = note.diskMtime;
    hideConflict();
    saveNote();
});

document.getElementById("notes-conflict-reload").addEventListener("click", async function () {
    try {
        await loadNoteFromDisk(note.path);
        setNoteStatus("바뀐 내용을 불러왔어요");
        showReadOrEdit();
    } catch (error) {
        showToast("노트를 불러오지 못했습니다: " + error.message);
    }
});

// 열어 둔 노트가 밖에서 바뀌었는지 몇 초마다 확인한다 (수정 시각만 묻는 가벼운 요청이다)
async function pollNote() {
    if (!isNotesTabActive() || !note.path || note.saving || note.conflict || document.hidden) {
        return;
    }
    const path = note.path;
    try {
        const response = await fetch(noteUrl("/api/notes/stat", path));
        if (path !== note.path || note.saving) {
            return;  // 확인하는 사이에 다른 노트로 옮겼거나 저장이 시작됐다
        }
        if (response.status === 404) {
            setNoteStatus("파일을 찾을 수 없어요 (Obsidian에서 지우거나 이름을 바꿨을 수 있어요)", true);
            return;
        }
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        if (data.mtime === note.mtime) {
            return;
        }
        if (note.dirty) {
            showConflict(data.mtime);
        } else {
            await loadNoteFromDisk(path);
            showReadOrEdit();
            setNoteStatus("Obsidian에서 바뀐 내용을 불러왔어요");
        }
    } catch (error) {
        // 서버(내 컴퓨터)에 잠깐 못 닿은 것이므로 다음 번에 다시 확인한다
    }
}
setInterval(pollNote, NOTE_POLL_INTERVAL_MS);

// ----- 새 노트 -----

document.getElementById("notes-new").addEventListener("click", function () {
    // 지금 열어 둔 노트의 폴더를 미리 적어 둔다 ("학업/" 같은 모양)
    const folder = note.path && note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/") + 1) : "";
    noteNameInput.value = folder;
    noteErrorElement.textContent = "";
    noteDialog.showModal();
    noteNameInput.focus();
});

document.getElementById("note-cancel").addEventListener("click", function () {
    noteDialog.close();
});

async function createNote() {
    try {
        const created = await notesRequest("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: noteNameInput.value }),
        });
        noteDialog.close();
        notesSearch.value = "";
        notesQuery = "";
        await loadNotesList();
        await openNote(created.path, { edit: true });
    } catch (error) {
        noteErrorElement.textContent = error.message;
    }
}

document.getElementById("note-create").addEventListener("click", createNote);
noteNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        createNote();
    }
});

// ----- 탭을 열 때 -----

// 노트 탭을 열 때마다 목록을 새로 받고, 열어 둔 노트가 없으면 지난번에 보던 노트를 연다
async function openNotesTab() {
    try {
        await settingsReady;  // vault 경로와 지난번 노트가 설정에 들어 있으므로 설정을 먼저 불러온 상태여야 한다
        const data = await loadNotesList();
        if (!data.configured || data.error) {
            return;
        }
        if (!note.path && settings.lastNote && notesList.some(function (item) {
            return item.path === settings.lastNote;
        })) {
            await openNote(settings.lastNote);
        }
    } catch (error) {
        showToast("노트 목록을 불러오지 못했습니다: " + error.message);
    }
}

// ----- 설정 탭의 vault 경로 칸 -----

function showVaultStatus(text, isError) {
    vaultPathStatus.textContent = text;
    vaultPathStatus.classList.toggle("error", Boolean(isError));
}

vaultPathInput.addEventListener("change", async function () {
    await flushNote();  // 폴더를 바꾸기 전에 열어 둔 노트의 수정을 원래 폴더에 저장한다
    settings.vaultPath = vaultPathInput.value.trim();
    settings.lastNote = "";
    await saveSettings();

    // 다른 vault로 바뀌었으니 열어 둔 노트를 닫는다
    note.path = null;
    note.dirty = false;
    hideConflict();
    notesEditor.hidden = true;
    notesEmpty.hidden = false;
    openFolders.clear();

    try {
        const data = await loadNotesList();
        if (!data.configured) {
            showVaultStatus("폴더 경로를 지웠어요. 노트 탭을 쓰려면 경로를 적어 주세요.");
        } else if (data.error) {
            showVaultStatus(data.error, true);
        } else {
            showVaultStatus("✓ 노트 " + data.notes.length + "개를 찾았어요.");
        }
    } catch (error) {
        showVaultStatus("확인하지 못했어요: " + error.message, true);
    }
});

// ---------- 설정 탭 ----------

// 현재 설정값. 서버에서 불러오기 전에도 코드가 안전하도록 최소한의 모양을 미리 만들어 둔다
let settings = { defaultCalendarId: "" };
// 일정을 쓸 수 있는 캘린더 목록 ({id, primary}). loadCalendarList가 채운다
const editableCalendars = [];

const sliderListElement = document.getElementById("slider-list");
const defaultCalendarSelect = document.getElementById("default-calendar-select");
const wrapAllDayCheckbox = document.getElementById("wrap-all-day-checkbox");
const pomodoroSliderListElement = document.getElementById("pomodoro-slider-list");
const pomodoroSoundCheckbox = document.getElementById("pomodoro-sound-checkbox");

// 설정 이름 → 그 값을 담는 CSS 변수 이름. 슬라이더 값이 바뀌면 이 CSS 변수를 바꾼다
const SETTING_CSS_VARS = {
    fontSize: "--cal-font-size",
    monthCellHeight: "--month-cell-height",
    timeSlotHeight: "--time-slot-height",
    cellMaxWidth: "--cell-max-width",
    eventGap: "--event-gap",
    sidebarWidth: "--sidebar-width",
    letterSpacing: "--letter-spacing",
};

// 설정 이름 → 단위("px", "em" 등). 서버가 알려준 슬라이더 정의에서 loadSettings가 채운다
const settingUnits = {};

// 설정값을 CSS 변수에 넣어서 화면에 반영한다
function applySettings() {
    for (const key in SETTING_CSS_VARS) {
        if (settings[key] !== undefined) {
            // documentElement = <html>. :root에 정의한 CSS 변수는 여기서 바꾼다
            document.documentElement.style.setProperty(SETTING_CSS_VARS[key], settings[key] + (settingUnits[key] || "px"));
        }
    }
    // 종일 일정 제목 줄바꿈: 값이 없으면(false가 아니면) 켜진 상태가 기본이다
    calendarElement.classList.toggle("wrap-all-day", settings.wrapAllDay !== false);
    // 칸 크기가 바뀌었으니 FullCalendar가 레이아웃을 다시 계산하게 한다
    calendar.updateSize();
    // Pomodoro 시간 설정이 바뀌었을 수 있으니 타이머 위젯도 맞춘다 (아래 "Pomodoro 타이머" 구역)
    pomodoroSettingsChanged();
}

// 설정을 서버에 보내 settings.json에 저장한다
async function saveSettings() {
    try {
        await sendRequest("/api/settings", "PUT", settings);
    } catch (error) {
        showToast("설정을 저장하지 못했습니다: " + error.message);
    }
}

// 슬라이더 한 줄(이름 + 슬라이더 + 현재 값)을 만들어 container에 붙인다. def는 서버가 알려준 슬라이더 정의다
function buildSlider(def, container) {
    settingUnits[def.key] = def.unit;

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
    container.appendChild(row);

    // input 이벤트: 슬라이더를 끄는 동안 계속 발생 → 화면에 즉시 반영
    slider.addEventListener("input", function () {
        settings[def.key] = Number(slider.value);
        valueText.textContent = slider.value + def.unit;
        applySettings();
    });
    // change 이벤트: 마우스를 놓았을 때 한 번 발생 → 이때 저장 (끄는 동안 저장 요청이 쏟아지지 않게)
    slider.addEventListener("change", saveSettings);
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
        wrapAllDayCheckbox.checked = settings.wrapAllDay !== false;

        // 저장되어 있던 "숨기기로 한 캘린더"를 숨김 목록(Set)에 옮겨 담는다
        hiddenCalendarIds.clear();
        (settings.hiddenCalendarIds || []).forEach(function (id) {
            hiddenCalendarIds.add(id);
        });

        pomodoroSoundCheckbox.checked = settings.pomodoroSound !== false;
        vaultPathInput.value = settings.vaultPath || "";

        // 혹시 이미 있던 슬라이더를 비우고, 화면 크기 슬라이더와 Pomodoro 슬라이더를 각자의 칸에 만든다
        sliderListElement.innerHTML = "";
        pomodoroSliderListElement.innerHTML = "";
        data.sliders.forEach(function (def) {
            buildSlider(def, sliderListElement);
        });
        (data.pomodoroSliders || []).forEach(function (def) {
            buildSlider(def, pomodoroSliderListElement);
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

// 설정 탭에서 종일 일정 줄바꿈 스위치를 눌렀을 때: 바로 반영하고 저장한다
wrapAllDayCheckbox.addEventListener("change", function () {
    settings.wrapAllDay = wrapAllDayCheckbox.checked;
    applySettings();
    saveSettings();
});

// 설정 탭에서 타이머 소리 스위치를 눌렀을 때: 저장만 하면 된다 (소리를 낼 때마다 설정을 읽는다)
pomodoroSoundCheckbox.addEventListener("change", function () {
    settings.pomodoroSound = pomodoroSoundCheckbox.checked;
    saveSettings();
});

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

// ---------- 자동 동기화 ----------
// 서버는 1분마다 Google에 "바뀐 게 있나?" 묻는다(syncToken). 화면은 그 결과를 15초마다 서버(내 컴퓨터)에서 확인해서,
// 폰 등에서 일정이 바뀌었다고 하면 일정을 다시 불러온다. 그래서 바뀐 일정이 길어도 1~2분 안에 보인다.

const syncStatusElement = document.getElementById("sync-status");
const syncTextElement = document.getElementById("sync-text");
const syncRefreshButton = document.getElementById("sync-refresh");

// 서버가 마지막으로 알려준 변경 번호. 이 번호가 달라지면 다른 곳에서 일정이 바뀐 것이다. null이면 아직 한 번도 못 받았다
let lastSeenVersion = null;
// 새로고침 요청이 진행 중인지
let refreshing = false;

// 동기화 상태 글자를 만든다. 예: "14:32 동기화", "오프라인 · 마지막 동기화 14:32"
function describeSync(status) {
    let when = "아직 동기화 안 됨";
    if (status.lastSync) {
        const date = new Date(status.lastSync * 1000);  // 서버는 초 단위, 자바스크립트는 밀리초 단위
        // 오늘이 아니면 날짜도 같이 보여줘서, 오래된 정보를 최신으로 착각하지 않게 한다
        const dayText = toDateText(date) === toDateText(new Date()) ? "" : (date.getMonth() + 1) + "/" + date.getDate() + " ";
        when = dayText + toTimeText(date) + " 동기화";
    }
    return status.online ? when : "오프라인 · 마지막 " + when;
}

function showSyncStatus(status) {
    syncTextElement.textContent = describeSync(status);
    syncStatusElement.classList.toggle("offline", !status.online);
}

// 지금 화면에 보이는 일정을 Google(서버)에서 다시 받아 온다. 캘린더 탭은 항상, 오늘 탭은 열려 있을 때만 새로고침한다
function reloadVisibleEvents() {
    calendar.refetchEvents();
    if (document.getElementById("today").classList.contains("active")) {
        loadTodayEvents().catch(function (error) {
            console.error("일정을 불러오지 못했습니다:", error);
        });
    }
}

// 서버에 동기화 상태를 물어본다
async function pollSyncStatus() {
    try {
        const response = await fetch("/api/sync-status");
        if (!response.ok) {
            return;
        }
        const status = await response.json();
        showSyncStatus(status);
        // 번호가 달라졌다 = 서버가 다른 곳에서 일정이 바뀐 것을 발견했다
        if (lastSeenVersion !== null && status.version !== lastSeenVersion) {
            reloadVisibleEvents();
        }
        lastSeenVersion = status.version;
    } catch (error) {
        // 서버(내 컴퓨터)에 잠깐 못 닿은 것이므로 조용히 넘어가고 다음 번에 다시 물어본다
    }
}

setInterval(pollSyncStatus, 15000);
pollSyncStatus();
// 최소화했던 창을 다시 열었을 때 곧바로 확인한다
document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
        pollSyncStatus();
    }
});

// 새로고침 버튼: Google에서 일정을 처음부터 다시 받아온다
syncRefreshButton.addEventListener("click", async function () {
    if (refreshing) {
        return;
    }
    refreshing = true;
    syncRefreshButton.disabled = true;
    syncTextElement.textContent = "새로고침 중...";
    try {
        const response = await fetch("/api/refresh", { method: "POST" });
        if (!response.ok) {
            throw new Error(await errorMessageFrom(response));
        }
        const status = await response.json();
        showSyncStatus(status);
        lastSeenVersion = status.version;  // 이 새로고침이 일으킨 변화로 한 번 더 불러오지 않게 번호를 맞춰둔다
        if (status.online) {
            reloadVisibleEvents();
        } else {
            showToast("인터넷에 연결할 수 없어 새로 불러오지 못했습니다. 마지막으로 받은 일정을 보여줍니다.");
        }
    } catch (error) {
        showToast("새로고침하지 못했습니다: " + error.message);
        pollSyncStatus();
    } finally {
        refreshing = false;
        syncRefreshButton.disabled = false;
    }
});

// ---------- Pomodoro 타이머 ----------
// 집중(기본 25분)과 휴식(짧게 5분, 집중 4번마다 길게 15분)을 번갈아 하는 타이머. 상단 바에 있어서 탭을 옮겨도 계속 돈다.
// 시간은 "1초마다 1씩 줄이기"가 아니라 "끝나는 시각(endTime)"을 기준으로 매번 남은 시간을 계산한다.
// 그래서 창이 최소화되거나 컴퓨터가 잠깐 느려져도 시간이 어긋나지 않는다. 상태는 메모리에만 있어서 프로그램을 끄면 초기화된다.

const pomodoroElement = document.getElementById("pomodoro");
const pomodoroPhaseElement = document.getElementById("pomodoro-phase");
const pomodoroTimeElement = document.getElementById("pomodoro-time");
const pomodoroToggleButton = document.getElementById("pomodoro-toggle");
const pomodoroSkipButton = document.getElementById("pomodoro-skip");
const pomodoroResetButton = document.getElementById("pomodoro-reset");

// 단계 이름 → 화면에 보일 이름, 시간(분)을 담은 설정 이름과 설정을 못 불러왔을 때 쓸 기본값
const POMODORO_PHASES = {
    focus: { label: "집중", settingKey: "pomodoroFocus", fallbackMinutes: 25 },
    short: { label: "짧은 휴식", settingKey: "pomodoroShortBreak", fallbackMinutes: 5 },
    long: { label: "긴 휴식", settingKey: "pomodoroLongBreak", fallbackMinutes: 15 },
};

const pomodoro = {
    phase: "focus",     // 지금 단계: "focus"(집중), "short"(짧은 휴식), "long"(긴 휴식)
    running: false,     // 시간이 흐르고 있는지
    started: false,     // 이 단계를 한 번이라도 시작했는지. 아직이면 설정에서 시간을 바꿀 때 표시도 같이 바뀐다
    endTime: 0,         // 흐르는 중일 때: 끝나는 시각 (Date.now()와 같은 밀리초 단위)
    remainingMs: 0,     // 멈춰 있을 때: 남은 시간 (밀리초)
    completedFocus: 0,  // 끝까지 채운 집중 횟수. 긴 휴식 시점을 정하는 데 쓴다
};

// 단계의 길이(밀리초)를 설정에서 읽는다
function pomodoroDurationMs(phase) {
    const info = POMODORO_PHASES[phase];
    const minutes = typeof settings[info.settingKey] === "number" ? settings[info.settingKey] : info.fallbackMinutes;
    return minutes * 60 * 1000;
}

// 지금 단계의 남은 시간 (밀리초)
function pomodoroRemainingMs() {
    return pomodoro.running ? Math.max(0, pomodoro.endTime - Date.now()) : pomodoro.remainingMs;
}

// 남은 시간을 "24:59" 모양으로 (한 시간이 넘으면 "1:05:00")
function formatPomodoroTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);  // 올림: 마지막 1초 동안 "0:01"이 보이고 끝나는 순간 "0:00"이 된다
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = function (n) {
        return String(n).padStart(2, "0");
    };
    return hours > 0 ? hours + ":" + pad(minutes) + ":" + pad(seconds) : pad(minutes) + ":" + pad(seconds);
}

// 위젯의 글자, 버튼, 진행 막대를 현재 상태에 맞춰 다시 그린다
function renderPomodoro() {
    const remaining = pomodoroRemainingMs();
    const duration = pomodoroDurationMs(pomodoro.phase);
    const info = POMODORO_PHASES[pomodoro.phase];

    pomodoroPhaseElement.textContent = info.label;
    pomodoroTimeElement.textContent = formatPomodoroTime(remaining);
    pomodoroToggleButton.textContent = pomodoro.running ? "⏸" : "▶";
    pomodoroToggleButton.title = pomodoro.running ? "일시정지" : (pomodoro.started ? "계속" : "시작");

    // 배경이 왼쪽부터 차오르는 정도 (0~100%)
    const elapsedPercent = duration > 0 ? Math.min(100, Math.max(0, (1 - remaining / duration) * 100)) : 0;
    pomodoroElement.style.setProperty("--pomodoro-progress", elapsedPercent.toFixed(2) + "%");
    pomodoroElement.classList.toggle("focus", pomodoro.phase === "focus");
    pomodoroElement.classList.toggle("break", pomodoro.phase !== "focus");
    pomodoroElement.classList.toggle("running", pomodoro.running);

    const every = typeof settings.pomodoroLongEvery === "number" ? settings.pomodoroLongEvery : 4;
    const untilLong = every - (pomodoro.completedFocus % every);
    pomodoroElement.title = "끝까지 채운 집중 " + pomodoro.completedFocus + "번 · 긴 휴식까지 " + untilLong + "번\n끌어서 옮길 수 있어요 (두 번 클릭하면 원래 자리로)";
    pomodoroResetButton.title = "처음부터 다시 (집중 " + Math.round(pomodoroDurationMs("focus") / 60000) + "분부터)";
}

// 설정이 바뀌었을 때 (applySettings가 부른다). 아직 시작 안 한 단계는 새 시간으로 바꾸고, 진행 중인 단계는 그대로 둔다
function pomodoroSettingsChanged() {
    if (!pomodoro.started) {
        pomodoro.remainingMs = pomodoroDurationMs(pomodoro.phase);
    }
    renderPomodoro();
    applyPomodoroPosition();
}

// ----- 시계: 0.25초마다 pomodoroTick을 부른다 -----
// 창이 최소화되면 브라우저는 일반 setInterval을 크게 늦춘다(최대 1분에 한 번). 공부하는 동안 창을 뒤로 보내 두는 일이 많으니,
// 그런 제한을 덜 받는 Web Worker(화면과 따로 도는 작은 일꾼)에게 시계를 맡긴다. 만들 수 없으면 setInterval로 대신한다
let pomodoroWorker = null;
let pomodoroFallbackTimer = null;

function startPomodoroClock() {
    stopPomodoroClock();
    try {
        if (!pomodoroWorker) {
            const code = "let timer = null; onmessage = function (e) { clearInterval(timer); " +
                "if (e.data === 'start') { timer = setInterval(function () { postMessage(0); }, 250); } };";
            pomodoroWorker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
            pomodoroWorker.onmessage = pomodoroTick;
        }
        pomodoroWorker.postMessage("start");
    } catch (error) {
        pomodoroFallbackTimer = setInterval(pomodoroTick, 250);
    }
}

function stopPomodoroClock() {
    if (pomodoroWorker) {
        pomodoroWorker.postMessage("stop");
    }
    clearInterval(pomodoroFallbackTimer);
    pomodoroFallbackTimer = null;
}

function pomodoroTick() {
    if (!pomodoro.running) {
        return;
    }
    if (pomodoroRemainingMs() <= 0) {
        finishPomodoroPhase();
    } else {
        renderPomodoro();
    }
}

// ----- 소리 -----
// 브라우저는 사용자가 아무것도 안 눌렀는데 갑자기 나는 소리를 막는다. 그래서 시작 버튼을 누를 때 소리 장치를 미리 깨워 둔다
let pomodoroAudio = null;

function unlockPomodoroAudio() {
    try {
        if (!pomodoroAudio) {
            pomodoroAudio = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (pomodoroAudio.state === "suspended") {
            pomodoroAudio.resume();
        }
    } catch (error) {
        pomodoroAudio = null;  // 소리를 못 내도 타이머는 계속 쓸 수 있다
    }
}

// 맑은 종소리 같은 소리를 낸다. 음 높이(Hz)를 차례로 하나씩: 집중이 끝나면 올라가는 소리, 휴식이 끝나면 내려오는 소리
function playPomodoroChime(frequencies) {
    if (settings.pomodoroSound === false) {
        return;
    }
    unlockPomodoroAudio();
    if (!pomodoroAudio) {
        return;
    }
    const start = pomodoroAudio.currentTime;
    frequencies.forEach(function (frequency, index) {
        const oscillator = pomodoroAudio.createOscillator();  // 정해진 높이의 소리를 만드는 장치
        const volume = pomodoroAudio.createGain();            // 소리 크기를 조절하는 장치
        const noteStart = start + index * 0.22;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        // 크기를 0에서 순식간에 올렸다가 서서히 줄여서 "딩" 하는 소리로 만든다
        volume.gain.setValueAtTime(0.0001, noteStart);
        volume.gain.exponentialRampToValueAtTime(0.25, noteStart + 0.02);
        volume.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.9);
        oscillator.connect(volume);
        volume.connect(pomodoroAudio.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + 1);
    });
}

// ----- 단계 전환 -----

// 새 단계로 바꾼다. 시간은 아직 흐르지 않는 상태(시작 전)로 준비해 둔다
function setPomodoroPhase(phase) {
    pomodoro.phase = phase;
    pomodoro.running = false;
    pomodoro.started = false;
    pomodoro.remainingMs = pomodoroDurationMs(phase);
    stopPomodoroClock();
    renderPomodoro();
}

function startPomodoro() {
    unlockPomodoroAudio();
    pomodoro.endTime = Date.now() + pomodoro.remainingMs;
    pomodoro.running = true;
    pomodoro.started = true;
    pomodoroElement.classList.remove("done");
    startPomodoroClock();
    renderPomodoro();
}

function pausePomodoro() {
    pomodoro.remainingMs = pomodoroRemainingMs();
    pomodoro.running = false;
    stopPomodoroClock();
    renderPomodoro();
}

// 단계를 끝까지 채웠을 때: 소리와 알림을 내고 다음 단계를 (멈춘 채로) 준비한다
function finishPomodoroPhase() {
    const finished = pomodoro.phase;
    let next = "focus";
    let message = "휴식이 끝났어요. 다시 집중해 볼까요?";
    if (finished === "focus") {
        pomodoro.completedFocus += 1;
        const every = typeof settings.pomodoroLongEvery === "number" ? settings.pomodoroLongEvery : 4;
        next = pomodoro.completedFocus % every === 0 ? "long" : "short";
        message = "집중 " + pomodoro.completedFocus + "번 완료! " + POMODORO_PHASES[next].label + " " +
            Math.round(pomodoroDurationMs(next) / 60000) + "분을 쉬세요.";
    }
    setPomodoroPhase(next);
    playPomodoroChime(finished === "focus" ? [660, 880, 1320] : [1320, 990, 660]);
    showToast(message, 8000);
    // 위젯이 잠깐 두근거려서 눈에 띄게 한다. 사용자가 시작 버튼을 누르면 멈춘다
    pomodoroElement.classList.add("done");
}

// 건너뛰기: 지금 단계를 접고 다음 단계로 간다. 집중을 건너뛴 것은 "끝까지 채운 횟수"에 세지 않는다.
// 시간이 흐르는 중에 건너뛰었다면 다음 단계도 바로 시작한다
function skipPomodoro() {
    const wasRunning = pomodoro.running;
    // 집중을 건너뛰면 짧은 휴식으로, 휴식을 건너뛰면 집중으로 간다
    const next = pomodoro.phase === "focus" ? "short" : "focus";
    setPomodoroPhase(next);
    if (wasRunning) {
        startPomodoro();
    }
}

// 처음부터 다시: 집중 단계 맨 처음으로 돌아가고 횟수도 0으로. 진행 중인 것을 실수로 날리지 않게 시작한 뒤에는 한 번 더 눌러야 한다
let pomodoroResetTimer = null;

function cancelPomodoroResetConfirm() {
    clearTimeout(pomodoroResetTimer);
    pomodoroResetTimer = null;
    pomodoroResetButton.textContent = "↺";
}

pomodoroToggleButton.addEventListener("click", function () {
    cancelPomodoroResetConfirm();
    if (pomodoro.running) {
        pausePomodoro();
    } else {
        startPomodoro();
    }
});

pomodoroSkipButton.addEventListener("click", function () {
    cancelPomodoroResetConfirm();
    skipPomodoro();
});

pomodoroResetButton.addEventListener("click", function () {
    const hasProgress = pomodoro.started || pomodoro.completedFocus > 0 || pomodoro.phase !== "focus";
    if (hasProgress && !pomodoroResetTimer) {
        pomodoroResetButton.textContent = "정말?";
        pomodoroResetTimer = setTimeout(cancelPomodoroResetConfirm, 3000);
        return;
    }
    cancelPomodoroResetConfirm();
    pomodoro.completedFocus = 0;
    setPomodoroPhase("focus");
    pomodoroElement.classList.remove("done");
});

// 최소화했던 창을 다시 열면 곧바로 남은 시간을 맞춘다 (그 사이에 끝났다면 끝 처리도 바로 한다)
document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
        pomodoroTick();
    }
});

// ----- 끌어서 옮기기 -----
// 위젯을 마우스로 끌면 상단 바에서 떨어져 나와(position: fixed) 화면 어디에나 놓을 수 있다. 놓은 자리는 settings.json에 저장된다.
// 포인터 이벤트(pointerdown/move/up)는 마우스, 터치, 펜을 한꺼번에 다루는 이벤트다.
// 끄는 동안 하는 일은 위젯 하나의 left/top 값 두 개를 바꾸는 것뿐이라 컴퓨터에 주는 부담은 거의 없다.

const POMODORO_DRAG_THRESHOLD = 4;  // 이 거리(px) 이상 움직여야 "끌기"로 본다. 클릭하다 살짝 흔들린 것은 무시
let pomodoroDrag = null;            // 끌고 있는 중에만 값이 있다: { startX, startY, offsetX, offsetY, moved }

// 위젯이 화면 밖으로 나가지 않게 좌표를 화면 안으로 맞춘다
function clampPomodoroPosition(x, y) {
    const maxX = Math.max(0, window.innerWidth - pomodoroElement.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - pomodoroElement.offsetHeight);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
}

function placePomodoro(x, y) {
    const position = clampPomodoroPosition(x, y);
    pomodoroElement.classList.add("floating");
    pomodoroElement.style.left = position.x + "px";
    pomodoroElement.style.top = position.y + "px";
}

// 저장된 위치(settings.pomodoroPosition)를 화면에 반영한다. 없으면 원래 자리(상단 바 가운데)로 돌려놓는다
function applyPomodoroPosition() {
    if (pomodoroDrag && pomodoroDrag.moved) {
        return;  // 끄는 중에는 건드리지 않는다
    }
    const position = settings.pomodoroPosition;
    if (position && typeof position.x === "number" && typeof position.y === "number") {
        placePomodoro(position.x, position.y);
    } else {
        pomodoroElement.classList.remove("floating");
        pomodoroElement.style.left = "";
        pomodoroElement.style.top = "";
    }
}

pomodoroElement.addEventListener("pointerdown", function (e) {
    // 버튼을 누른 것은 끌기가 아니다. 마우스는 왼쪽 버튼만
    if (e.target.closest("button") || (e.pointerType === "mouse" && e.button !== 0)) {
        return;
    }
    const rect = pomodoroElement.getBoundingClientRect();
    pomodoroDrag = { startX: e.clientX, startY: e.clientY, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, moved: false };
    // 마우스가 위젯 밖으로 빠르게 나가도 계속 이 위젯이 이벤트를 받게 한다
    pomodoroElement.setPointerCapture(e.pointerId);
});

pomodoroElement.addEventListener("pointermove", function (e) {
    if (!pomodoroDrag) {
        return;
    }
    if (!pomodoroDrag.moved && Math.hypot(e.clientX - pomodoroDrag.startX, e.clientY - pomodoroDrag.startY) < POMODORO_DRAG_THRESHOLD) {
        return;
    }
    pomodoroDrag.moved = true;
    pomodoroElement.classList.add("dragging");
    placePomodoro(e.clientX - pomodoroDrag.offsetX, e.clientY - pomodoroDrag.offsetY);
});

function endPomodoroDrag() {
    if (!pomodoroDrag) {
        return;
    }
    const moved = pomodoroDrag.moved;
    pomodoroDrag = null;
    pomodoroElement.classList.remove("dragging");
    if (moved) {
        // 놓은 자리를 저장한다 (놓은 뒤에 한 번만 저장해서 끄는 동안 저장 요청이 쏟아지지 않는다)
        const rect = pomodoroElement.getBoundingClientRect();
        settings.pomodoroPosition = { x: Math.round(rect.left), y: Math.round(rect.top) };
        saveSettings();
    }
}

pomodoroElement.addEventListener("pointerup", endPomodoroDrag);
pomodoroElement.addEventListener("pointercancel", endPomodoroDrag);

// 원래 자리로: 위젯의 빈 곳을 두 번 클릭하거나, 설정 탭의 버튼을 누른다
function resetPomodoroPosition() {
    settings.pomodoroPosition = null;
    applyPomodoroPosition();
    saveSettings();
}

pomodoroElement.addEventListener("dblclick", function (e) {
    if (!e.target.closest("button")) {
        resetPomodoroPosition();
    }
});

document.getElementById("pomodoro-position-reset").addEventListener("click", resetPomodoroPosition);

// 창 크기를 줄였을 때 위젯이 화면 밖에 갇히지 않게 다시 맞춘다
window.addEventListener("resize", applyPomodoroPosition);

pomodoro.remainingMs = pomodoroDurationMs("focus");  // 설정을 불러오기 전에는 기본 25분으로 시작
renderPomodoro();
