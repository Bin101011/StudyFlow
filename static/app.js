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
            refreshCalendarTasks();  // 다른 탭에서 할 일을 끝내거나 추가했을 수 있다
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

// ----- 캘린더에 "할 일" 표시 (일정 아래에 구분선과 한 줄 요약) -----
// 날짜별 할 일 개수를 달력 칸의 일정 아래에 "할 일 6개 · 5 남음"으로 보여준다. 마우스를 올리면 목록이 뜨고, 누르면 오늘 탭의 그 날짜로 간다.
// 아래 변수들은 달력을 만드는 순간(calendar.render)에 불려 가는 함수들이 쓰므로, 달력보다 먼저 선언해 둔다.
let calendarTaskDays = {};      // 날짜 "2026-10-27" → 그날의 할 일들 [{id, content, done, project_name, project_color}]
let calendarTaskRange = null;   // 지금 받아 둔 기간 { start, end } (end는 포함하지 않는 날짜)
let calendarTaskRequest = 0;    // 가장 최근에 보낸 요청의 번호. 달을 빠르게 넘길 때 늦게 온 옛 응답을 버리려는 것이다
let calendarTaskRenderPending = false;  // 요약을 다시 붙이는 일이 이미 예약되어 있는지 (칸이 한꺼번에 여러 개 그려질 때 한 번만 하려는 것)
// 월간 보기에서 오늘 칸을 화면 가운데로 맞추는 일을 "언제까지" 계속할지 (Date.now() 기준 밀리초, 0이면 하지 않는다).
// 일정과 할 일 요약은 달력보다 조금 늦게 도착해서 위쪽 줄의 높이를 바꾸므로, 도착할 때마다 다시 맞춰야 오늘이 제자리에 온다
let centerTodayUntil = 0;
const CENTER_TODAY_SETTLE_MS = 2500;  // 달력이 그려진 뒤 일정과 요약이 도착하는 데 걸리는 시간을 넉넉히 잡은 값

// ----- 월간 보기의 줄 수 -----
// FullCalendar의 기본 월간 보기(dayGridMonth)는 항상 6줄로 맞추고 그 줄 수를 바꿀 방법이 없다(5주짜리 달은 다음 달 1주가 붙는다).
// 그래서 보이는 기간을 직접 계산하는 보기(MONTH_VIEW)를 만들어 쓴다: 그 달 1일이 있는 주부터 줄 수만큼의 주.
// 줄 수는 설정 탭에서 6줄 또는 7줄로 정한다. 7줄이면 5주짜리 달은 다음 달 2주, 6주짜리 달은 다음 달 1주가 붙어서 월말에도 앞날을 미리 볼 수 있다.
// 어느 쪽이든 그 달이 필요한 주 수보다 줄이지는 않는다(6줄로 정했는데 6주가 필요한 달이면 6줄). 그래야 달의 끝이 잘리지 않는다.
// monthRowsSetting은 달력을 만드는 순간(calendar.render)에 불려 가는 monthVisibleRange가 쓰므로, 달력보다 먼저 선언해 둔다
// (설정(settings)은 뒤에서 선언되어서 여기서는 쓸 수 없다. applySettings가 설정값을 이 변수에 옮겨 준다)
const MONTH_VIEW = "monthGrid";
let monthRowsSetting = 6;
let lastShownMonth = null;  // 월간 보기에서 마지막으로 보던 달(그 달의 아무 날짜). 주간/일간을 보다가 월간으로 돌아올 때 쓴다 (아래 "월간 보기 이동")

// year년 month월(0~11)의 날짜들이 일요일 시작 달력에서 몇 주에 걸치는지 (4~6)
function monthWeeksNeeded(year, month) {
    const firstWeekday = new Date(year, month, 1).getDay();  // 1일의 요일 (일요일이 0)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Math.ceil((firstWeekday + daysInMonth) / 7);
}

// FullCalendar가 "이 날짜(currentDate)를 볼 때 보여줄 기간"을 물으면 대답하는 함수. end는 포함하지 않는 날짜다
function monthVisibleRange(currentDate) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());  // 1일이 있는 주의 일요일
    const rows = Math.max(monthRowsSetting, monthWeeksNeeded(year, month));
    return { start: start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + rows * 7) };
}

// 보이는 기간의 시작일(rangeStart)로 "지금 어느 달을 보고 있는지"를 알아낸다. 시작일은 1일이 있는 주의 일요일이라
// 그날부터 6일 뒤(그 주의 토요일)까지는 반드시 1일을 지나므로, 6일 뒤 날짜의 달이 보고 있는 달이다 (예: 9월 27일 시작 → 10월 3일 → 10월).
// FullCalendar가 알려주는 "현재 날짜"(calendar.getDate())는 이동할 때마다 보이는 기간의 시작일(이전 달 날짜일 수 있다)로 바뀌어서 쓰지 못한다.
// 돌려주는 값은 그 달의 아무 날짜(Date)다
function shownMonthDate(rangeStart) {
    return new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + 6);
}

function isSameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// FullCalendar 달력 객체를 만든다. 두 번째 칸에 설정을 적는다
const calendar = new FullCalendar.Calendar(calendarElement, {
    // 처음 열면 월간 보기
    initialView: MONTH_VIEW,

    // 달력 맨 위 줄: 왼쪽(이전/다음/오늘), 가운데(제목), 오른쪽(월/주/일 전환)
    headerToolbar: {
        left: "prev,next today",
        center: "title",
        right: MONTH_VIEW + ",timeGridWeek,timeGridDay",
    },

    // 월간 보기의 정의: 줄 수를 직접 정하는 보기(위 설명). 이전/다음 이동은 FullCalendar에 맡기지 않고 우리가 직접 한 달씩 옮긴다(아래 "월간 보기 이동")
    views: {
        [MONTH_VIEW]: {
            type: "dayGrid",
            visibleRange: monthVisibleRange,
            buttonText: "월간",
            // 제목은 기간("9월 27일 – 11월 14일")이 아니라 보고 있는 달("2026년 10월")로. 인자의 start는 보이는 기간의 시작일이다
            titleFormat: function (arg) {
                const shown = shownMonthDate(new Date(arg.start.year, arg.start.month, arg.start.day));
                return shown.getFullYear() + "년 " + (shown.getMonth() + 1) + "월";
            },
        },
    },

    // 보이는 기간에는 앞뒤 달의 날짜도 들어 있다. FullCalendar는 보이는 기간 밖의 날짜만 "다른 달"로 흐리게 칠하는데,
    // 이 보기에서는 보이는 기간이 곧 달력 전체라서 다른 달 날짜를 우리가 직접 흐리게 표시한다 (기존 월간 보기와 같은 모양으로)
    dayCellClassNames: function (arg) {
        if (arg.view.type === MONTH_VIEW && !isSameMonth(arg.date, shownMonthDate(arg.view.activeStart))) {
            return ["fc-day-other"];
        }
        return [];
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

    // 보이는 기간이 바뀔 때(달/주/일을 넘기거나 보기를 바꿀 때)마다 그 기간의 할 일을 받아 온다
    datesSet: function (info) {
        loadCalendarTasks(info.startStr.slice(0, 10), info.endStr.slice(0, 10));
        // 월간 보기에서 보고 있는 달이 오늘이 있는 달이면 오늘 칸을 화면 가운데로 가져온다 (달을 넘겼다가 돌아와도 맨 위로 가지 않는다).
        // 앞 달을 볼 때 맨 아래에 붙는 다음 달 주에 오늘이 들어 있어도 가운데로 가져오지 않는다(그 달이 아니라서)
        const now = new Date();
        if (info.view.type === MONTH_VIEW && isSameMonth(shownMonthDate(info.start), now)) {
            startCenteringOnToday();
        }
        syncMonthTodayButton(info);
    },
    // 일정이 다시 그려지거나 창 크기가 바뀌면 FullCalendar가 칸 안쪽을 다시 만들 수 있으므로, 할 일 요약을 다시 붙인다
    eventsSet: function () {
        renderCalendarTaskFooters();
    },
    windowResize: function () {
        renderCalendarTaskFooters();
    },
    // 날짜 칸이 새로 그려질 때마다(보기를 바꾼 직후 주간 보기의 "종일" 줄 칸 등) 요약을 붙인다.
    // 할 일 데이터가 칸보다 먼저 도착하는 경우가 있어서, 데이터가 올 때만 붙이면 빠지는 칸이 생긴다
    dayCellDidMount: function () {
        scheduleCalendarTaskFooters();
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

// ----- 월간 보기 이동 -----
// 이전/다음/보기 전환을 FullCalendar에 맡기면 이 보기에서는 어긋난다: FullCalendar는 이동할 때 "현재 날짜 + 1개월"을 계산하는데,
// 이 보기의 현재 날짜는 이동할 때마다 보이는 기간의 시작일(이전 달 날짜일 수 있다)로 바뀌어서, 12월에서 "다음"을 눌러도 12월에 머물고
// "이전"은 두 달씩 건너뛰었다(실제로 확인했다). 그래서 월간 보기에서는 "보고 있는 달"(shownMonthDate)을 기준으로 우리가 직접 한 달씩 옮긴다.
// 이전/다음 버튼과 키보드 ←/→는 모두 calendar.prev()/next()를 부르므로, 이 두 메서드를 바꿔 끼우면 둘 다 고쳐진다
function gotoShownMonth(delta) {
    const shown = shownMonthDate(calendar.view.activeStart);
    // 15일로 가는 이유: 그 달의 어느 날로 가든 같은 달이 보이지만, 1일 같은 날은 FullCalendar가 저장해 둔 현재 날짜와 같아서
    // "이미 거기 있다"고 보고 다시 그리지 않을 수 있다(줄 수 설정을 바꾸고 같은 달을 다시 그릴 때 필요하다)
    calendar.gotoDate(new Date(shown.getFullYear(), shown.getMonth() + delta, 15));
}
const nativeCalendarPrev = calendar.prev;
const nativeCalendarNext = calendar.next;
const nativeCalendarChangeView = calendar.changeView;
calendar.prev = function () {
    if (calendar.view.type === MONTH_VIEW) {
        gotoShownMonth(-1);
    } else {
        nativeCalendarPrev.call(calendar);
    }
};
calendar.next = function () {
    if (calendar.view.type === MONTH_VIEW) {
        gotoShownMonth(1);
    } else {
        nativeCalendarNext.call(calendar);
    }
};
// 보기를 바꿀 때(월간 ↔ 주간/일간)는 FullCalendar가 저장해 둔 "현재 날짜"에 맡기지 않고 날짜를 직접 정해 준다.
// 그 날짜는 보이는 기간의 시작일(이전 달일 수 있다)로 바뀌어 있어서, 맡기면 9월에서 주간으로 갔다가 월간으로 돌아올 때 8월이 나왔다(실제로 확인했다).
//  - 월간 → 주간/일간: 오늘이 보던 달이면 오늘, 아니면 그 달 8일(8일의 주는 항상 그 달 안에서 시작한다)
//  - 주간/일간 → 월간: 방금 보던 달(lastShownMonth)이 지금 보는 주/일과 겹치면 그 달로, 아니면 그 주의 수요일이 속한 달로
calendar.changeView = function (viewType, dateOrRange) {
    const current = calendar.view;
    if (dateOrRange === undefined && current.type === MONTH_VIEW && viewType !== MONTH_VIEW) {
        const shown = shownMonthDate(current.activeStart);
        const now = new Date();
        dateOrRange = isSameMonth(shown, now) ? now : new Date(shown.getFullYear(), shown.getMonth(), 8);
    } else if (dateOrRange === undefined && current.type !== MONTH_VIEW && viewType === MONTH_VIEW) {
        const start = current.activeStart;
        const end = current.activeEnd;
        const overlaps = lastShownMonth !== null &&
            new Date(lastShownMonth.getFullYear(), lastShownMonth.getMonth(), 1) < end &&
            new Date(lastShownMonth.getFullYear(), lastShownMonth.getMonth() + 1, 1) > start;
        // 주간이면 시작일 + 3일이 수요일이고, 일간이면 그날 하나뿐이라 시작일을 그대로 쓴다
        const middle = current.type === "timeGridDay" ? start : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3);
        dateOrRange = overlaps ? new Date(lastShownMonth.getFullYear(), lastShownMonth.getMonth(), 15) : middle;
    }
    return nativeCalendarChangeView.call(calendar, viewType, dateOrRange);
};

// "오늘" 버튼: FullCalendar는 오늘이 보이는 기간 안에 있으면 버튼을 꺼 버린다. 이 보기는 앞 달을 볼 때 다음 달 주도 보이므로
// (예: 9월을 보는데 아래에 10월 3일이 있다) 그때도 꺼져서 오늘 달로 돌아갈 수 없게 된다. 그래서 "보고 있는 달이 오늘의 달일 때만" 끈다
function syncMonthTodayButton(info) {
    if (info.view.type !== MONTH_VIEW) {
        return;
    }
    lastShownMonth = shownMonthDate(info.start);  // 주간/일간으로 갔다가 돌아올 때 이 달로 돌아오기 위해 기억해 둔다
    // 버튼은 이 함수를 부른 직후에 FullCalendar가 다시 그릴 수 있으므로, 한 박자 뒤에 맞춘다
    setTimeout(function () {
        const button = calendarElement.querySelector(".fc-today-button");
        if (button) {
            button.disabled = isSameMonth(shownMonthDate(info.start), new Date());
        }
    }, 0);
}

// 서버에서 이 기간의 날짜별 할 일을 받아 와서 달력에 붙인다. 실패해도 일정은 멀쩡히 보여야 하므로 조용히 넘어간다(콘솔에만 남김)
async function loadCalendarTasks(start, end) {
    calendarTaskRange = { start: start, end: end };
    const requestNumber = ++calendarTaskRequest;
    try {
        const response = await fetch("/api/task-days?start=" + start + "&end=" + end);
        if (!response.ok) {
            throw new Error(await errorMessageFrom(response));
        }
        const days = await response.json();
        if (requestNumber !== calendarTaskRequest) {
            return;  // 그 사이에 다른 달로 넘어갔다. 이 응답은 낡은 것이다
        }
        calendarTaskDays = days;
        renderCalendarTaskFooters();
    } catch (error) {
        console.error("달력에 보여줄 할 일을 불러오지 못했습니다:", error);
    }
}

// 칸이 여러 개 그려질 때 칸마다 부르지 않고, 화면을 그리기 직전에 한 번만 요약을 붙인다
function scheduleCalendarTaskFooters() {
    if (calendarTaskRenderPending) {
        return;
    }
    calendarTaskRenderPending = true;
    requestAnimationFrame(function () {
        calendarTaskRenderPending = false;
        renderCalendarTaskFooters();
    });
}

// 지금 보고 있는 기간의 할 일을 다시 받는다 (다른 탭에서 할 일을 끝내거나 추가했을 수 있어서, 캘린더 탭을 열 때 부른다)
function refreshCalendarTasks() {
    if (calendarTaskRange) {
        loadCalendarTasks(calendarTaskRange.start, calendarTaskRange.end);
    }
}

// 한 날짜의 요약 글자와 상태. 끝낸 것까지 모두 세고, 안 끝낸 것이 남아 있는지로 모양을 정한다
function summarizeTaskDay(tasks, dateText) {
    const remaining = tasks.filter(function (task) {
        return task.done !== 1;
    }).length;
    const today = toDateText(new Date());
    return {
        text: remaining > 0
            ? "할 일 " + tasks.length + "개 · " + remaining + " 남음"
            : "할 일 " + tasks.length + "개 · 완료",
        allDone: remaining === 0,
        overdue: remaining > 0 && dateText < today,  // 지난 날짜에 아직 못 끝낸 것이 있다
    };
}

// 달력의 모든 날짜 칸(월간 칸, 주간/일간 보기 위쪽의 "종일" 줄 칸)에 요약을 붙이거나 고치거나 지운다.
// 칸의 .fc-daygrid-day-bottom은 FullCalendar가 일정들 바로 아래에 만들어 두는 자리다. 일정이 많아져도 그 아래로 밀려난다
function renderCalendarTaskFooters() {
    calendarElement.querySelectorAll(".fc-daygrid-day[data-date]").forEach(function (cell) {
        const dateText = cell.dataset.date;
        const tasks = calendarTaskDays[dateText];
        const slot = cell.querySelector(".fc-daygrid-day-bottom");
        let footer = cell.querySelector(".cal-task-footer");
        if (!slot || !tasks || tasks.length === 0) {
            if (footer) {
                footer.remove();
            }
            return;
        }
        if (!footer) {
            footer = document.createElement("div");
            footer.className = "cal-task-footer";
            slot.appendChild(footer);
            attachCalendarTaskFooterEvents(footer);
        }
        const summary = summarizeTaskDay(tasks, dateText);
        footer.dataset.date = dateText;
        footer.textContent = summary.text;
        footer.classList.toggle("all-done", summary.allDone);
        footer.classList.toggle("overdue", summary.overdue);
    });
    // 요약을 붙이면 칸 높이가 달라지므로, 오늘 맞추기 시간이 남아 있으면 오늘을 다시 가운데로 맞춘다
    if (Date.now() < centerTodayUntil) {
        centerOnToday();
    }
}

// ----- 월간 보기에서 오늘 칸을 화면 가운데로 -----
// 칸 높이가 커서 달력 안쪽이 스크롤되는 상태에서, 한 달의 후반부에 있는 오늘을 직접 스크롤해서 찾지 않아도 되게 한다.
// 맞추는 중에 사용자가 직접 스크롤하면(아래 이벤트) 바로 멈춰서, 사용자가 옮긴 위치를 되돌리지 않는다
// 오늘 칸을 달력의 스크롤 영역 세로 가운데에 놓는다. 오늘이 안 보이는 기간이거나 달력이 안 보이는 탭이면 아무것도 하지 않는다
function centerOnToday() {
    const cell = calendarElement.querySelector(".fc-daygrid-day.fc-day-today");
    if (!cell) {
        return;
    }
    const scroller = cell.closest(".fc-scroller");
    if (!scroller || scroller.clientHeight === 0) {
        return;  // 다른 탭에 가려져 있어서 크기를 잴 수 없다
    }
    // 스크롤 영역 맨 위에서 오늘 칸 맨 위까지의 거리 = (화면에서의 위치 차이) + (이미 스크롤된 만큼)
    const cellTop = cell.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    // 칸의 가운데가 스크롤 영역의 가운데에 오도록 맞춘다. 범위를 넘으면 브라우저가 맨 위/맨 아래로 알아서 자른다
    scroller.scrollTop = cellTop - (scroller.clientHeight - cell.offsetHeight) / 2;
}

// 오늘 맞추기를 시작한다: 지금 한 번 맞추고, 정해진 시간 동안은 칸 높이가 바뀔 때마다 다시 맞춘다
function startCenteringOnToday() {
    centerTodayUntil = Date.now() + CENTER_TODAY_SETTLE_MS;
    requestAnimationFrame(centerOnToday);  // 달력이 화면에 그려진 직후에 맞춘다
}

// 사용자가 직접 스크롤하거나 달력을 만지기 시작하면 더는 자동으로 맞추지 않는다
["wheel", "pointerdown", "keydown", "touchstart"].forEach(function (eventName) {
    calendarElement.addEventListener(eventName, function () {
        centerTodayUntil = 0;
    }, { passive: true });
});
// ("오늘" 버튼은 따로 처리하지 않아도 된다: 다른 달에서 누르면 기간이 바뀌어 datesSet이 맡고,
//  이번 달을 보고 있을 때는 FullCalendar가 버튼을 눌리지 않게 막아 둔다)

// 말풍선: 마우스를 올리면 그날의 할 일 목록을 보여준다. 하나만 만들어 두고 계속 쓴다
const calendarTaskTip = document.createElement("div");
calendarTaskTip.className = "cal-task-tip";
calendarTaskTip.hidden = true;
document.body.appendChild(calendarTaskTip);
const CALENDAR_TIP_MAX_ITEMS = 12;  // 이보다 많으면 "외 N개"로 줄인다

function showCalendarTaskTip(footer) {
    const dateText = footer.dataset.date;
    const tasks = calendarTaskDays[dateText] || [];
    calendarTaskTip.replaceChildren();

    const [year, month, day] = dateText.split("-").map(Number);
    const title = document.createElement("div");
    title.className = "cal-task-tip-title";
    title.textContent = month + "월 " + day + "일 할 일";
    calendarTaskTip.appendChild(title);

    tasks.slice(0, CALENDAR_TIP_MAX_ITEMS).forEach(function (task) {
        const row = document.createElement("div");
        row.className = "cal-task-tip-row" + (task.done === 1 ? " done" : "");
        const dot = document.createElement("span");
        dot.className = "cal-task-tip-dot";
        dot.style.backgroundColor = task.project_color || "#9aa4b2";
        const name = document.createElement("span");
        name.className = "cal-task-tip-name";
        name.textContent = task.content;
        row.append(dot, name);
        if (task.project_name) {
            const project = document.createElement("span");
            project.className = "cal-task-tip-project";
            project.textContent = task.project_name;
            row.appendChild(project);
        }
        calendarTaskTip.appendChild(row);
    });
    if (tasks.length > CALENDAR_TIP_MAX_ITEMS) {
        const more = document.createElement("div");
        more.className = "cal-task-tip-more";
        more.textContent = "외 " + (tasks.length - CALENDAR_TIP_MAX_ITEMS) + "개";
        calendarTaskTip.appendChild(more);
    }
    const hint = document.createElement("div");
    hint.className = "cal-task-tip-hint";
    hint.textContent = "누르면 오늘 탭에서 이 날짜를 봅니다";
    calendarTaskTip.appendChild(hint);

    calendarTaskTip.hidden = false;
    // 요약 줄 바로 위에 띄운다. 위가 모자라면 아래로, 가로는 화면 안으로
    const rect = footer.getBoundingClientRect();
    let top = rect.top - calendarTaskTip.offsetHeight - 6;
    if (top < 8) {
        top = rect.bottom + 6;
    }
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - calendarTaskTip.offsetWidth - 8));
    calendarTaskTip.style.left = left + "px";
    calendarTaskTip.style.top = top + "px";
}

function hideCalendarTaskTip() {
    calendarTaskTip.hidden = true;
}

function attachCalendarTaskFooterEvents(footer) {
    footer.addEventListener("mouseenter", function () {
        showCalendarTaskTip(footer);
    });
    footer.addEventListener("mouseleave", hideCalendarTaskTip);
    // FullCalendar는 "click"이 아니라 마우스를 누르고(mousedown) 떼는 동작으로 날짜 클릭을 알아챈다.
    // 그래서 시작 단계인 mousedown(터치는 touchstart)을 여기서 막아야 요약을 눌렀을 때 새 일정 창이 같이 열리지 않는다
    ["mousedown", "touchstart"].forEach(function (type) {
        footer.addEventListener(type, function (event) {
            event.stopPropagation();
        });
    });
    // 요약을 누르면 오늘 탭의 그 날짜로 간다
    footer.addEventListener("click", function (event) {
        event.stopPropagation();
        hideCalendarTaskTip();
        openTodayOn(footer.dataset.date);
    });
}
// 달력이 스크롤되거나 다른 곳을 누르면 말풍선이 어긋나므로 닫는다
window.addEventListener("scroll", hideCalendarTaskTip, true);

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
const eventMemoInput = document.getElementById("event-memo");
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
// 창을 열 때 메모 칸에 채운 글자. 저장할 때 이것과 달라졌을 때만 메모를 보낸다.
// (Google Calendar 웹에서 서식을 넣어 쓴 설명은 우리 칸에 글자만 보이므로, 메모를 안 고쳤다면 원래 서식을 건드리지 않으려는 것이다)
let eventMemoInitial = "";
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

// 일정의 메모(Google Calendar의 "설명" 칸)를 화면에 보일 글자로 바꾼다.
// 우리가 쓴 메모는 그냥 글자이지만, Google Calendar 웹에서 쓴 설명에는 <br>, <b>, <a> 같은 HTML이 섞여 올 수 있다.
// HTML이 보이면 태그를 걷어내고 글자만 남긴다. DOMParser는 글자를 HTML 문서로 읽어 주는 브라우저 도구인데,
// 화면에 붙이지 않은 채로 읽기만 하므로 안에 든 스크립트가 실행되지 않는다. (결과는 항상 textContent로만 화면에 넣는다)
function memoText(raw) {
    if (!raw) {
        return "";
    }
    // 완전한 태그(<b>, </p>, <br/>, <a href="...">)나 &amp; 같은 글자 코드가 있을 때만 HTML로 본다.
    // "3 < 5"나 "a<b" 같은 평범한 글자를 HTML로 오해해서 잘라먹지 않도록 일부러 엄격하게 본다
    if (!/<\/?[a-z][a-z0-9]*(\s[^>]*)?\/?>|&(amp|lt|gt|quot|nbsp|#\d+);/i.test(raw)) {
        return raw.trim();
    }
    const withBreaks = raw
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
    const doc = new DOMParser().parseFromString(withBreaks, "text/html");
    // <script>, <style> 안의 코드는 textContent에 글자로 딸려 오므로 먼저 없앤다
    doc.querySelectorAll("script, style").forEach(function (element) {
        element.remove();
    });
    return (doc.body.textContent || "").trim();
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
    const text = when ? when + "  " + event.title : event.title;
    // 메모가 있으면 제목 아래에 이어 붙인다 (툴팁은 줄바꿈을 보여준다). 너무 길면 앞부분만
    const memo = memoText(event.extendedProps.description);
    if (!memo) {
        return text;
    }
    return text + "\n\n" + (memo.length > 200 ? memo.slice(0, 200) + "…" : memo);
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

// ---------- 시간 입력칸 (직접 타이핑 + 5분 단위 선택창) ----------
// 브라우저 기본 시간칸(<input type="time">)은 "오전/오후 → 시 → 분" 칸이 따로 나뉘어 있어서, 칸을 누르면 맨 앞의 "오전"이 선택되고
// 숫자를 쳐도 아무 일도 안 일어난다. 그리고 시계 아이콘의 선택창은 분이 1분 단위로 나온다. 그래서 직접 만들었다:
//  - 입력 칸: 누르면 글자 전체가 선택되어 바로 타이핑할 수 있다. "1430", "930", "2:30pm", "오후 2시 30분" 어느 쪽으로 써도 "14:30"으로 정리된다
//  - 시계 아이콘: "시" 열과 "분" 열(00, 05, 10 … 55)이 있는 선택창을 연다
//  - ↑/↓ 키: 5분씩 (Shift를 같이 누르면 1시간씩)

function padTwo(number) {
    return String(number).padStart(2, "0");
}

// 글자로 쓴 시간을 "14:30" 모양(24시간)으로 바꾼다. 읽을 수 없으면 null
function parseTimeText(text) {
    let s = String(text).trim().toLowerCase();

    // 오전/오후(또는 am/pm)가 있으면 따로 떼어 둔다
    let meridiem = null;
    const meridiemMatch = /(오전|오후|a\.?m\.?|p\.?m\.?)/.exec(s);
    if (meridiemMatch) {
        meridiem = meridiemMatch[1] === "오후" || meridiemMatch[1][0] === "p" ? "pm" : "am";
        s = s.replace(meridiemMatch[0], "");
    }

    // 공백을 없애고, "시", ".", 전각 콜론을 ":"로 통일하고, "분"은 지운다. 예: "3시 30분" → "3:30"
    s = s.replace(/\s+/g, "").replace(/[시：.]/g, ":").replace(/분/g, "");

    let hour;
    let minute;
    let match;
    if ((match = /^(\d{1,2}):(\d{1,2})$/.exec(s))) {
        hour = Number(match[1]);  // "14:30", "9:5"
        minute = Number(match[2]);
    } else if ((match = /^(\d{1,2}):?$/.exec(s))) {
        hour = Number(match[1]);  // "14", "9시"
        minute = 0;
    } else if ((match = /^(\d{1,2})(\d{2})$/.exec(s))) {
        hour = Number(match[1]);  // 세네 자리 숫자: "930", "1430"
        minute = Number(match[2]);
    } else {
        return null;
    }

    // 오전/오후가 붙어 있고 시가 12 이하일 때만 12시간제로 계산한다 ("오후 14:00"처럼 이미 24시간제 값이면 그대로)
    if (meridiem && hour <= 12) {
        hour = meridiem === "pm" ? (hour % 12) + 12 : hour % 12;
    }
    if (hour > 23 || minute > 59) {
        return null;
    }
    return padTwo(hour) + ":" + padTwo(minute);
}

// 입력 칸의 글자를 "14:30" 모양으로 정리한다. 읽을 수 없으면 글자는 그대로 두고 칸 테두리를 빨갛게 한다
function normalizeTimeInput(input) {
    const parsed = parseTimeText(input.value);
    if (parsed) {
        input.value = parsed;
    }
    input.classList.toggle("invalid", !parsed);
    return parsed;
}

// 시간칸의 값을 확정한다: 글자를 "14:30" 모양으로 정리하고, 마지막으로 알린 값과 달라졌으면 change를 알린다.
// (브라우저가 직접 타이핑에는 칸을 떠날 때 change를 알려 주지만, Enter로 확정하거나 코드가 값을 바꾼 경우에는 우리가 알려야 한다.
// 같은 값으로 두 번 알려도 해가 없다. 읽는 쪽이 값이 같으면 같은 결과를 내기 때문이다)
function fireTimeChange(input) {
    input.dataset.committed = input.value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function commitTimeInput(input) {
    const parsed = normalizeTimeInput(input);
    if (parsed && parsed !== input.dataset.committed) {
        fireTimeChange(input);
    }
    return parsed;
}

// 선택창은 일정 창 안에 하나만 만들어 두고 두 시간칸(시작, 끝)이 같이 쓴다. (모달 창 밖에 만들면 창 뒤에 가려진다)
const timePopup = document.createElement("div");
timePopup.className = "time-popup";
timePopup.hidden = true;
const timeHourColumn = makeTimeColumn("시", Array.from({ length: 24 }, function (_, h) {
    return { label: padTwo(h), key: "hour", value: h };
}));
const timeMinuteColumn = makeTimeColumn("분", Array.from({ length: 12 }, function (_, i) {
    return { label: padTwo(i * 5), key: "minute", value: i * 5 };  // 0, 5, 10 … 55
}));
timePopup.append(timeHourColumn, timeMinuteColumn);
eventDialog.appendChild(timePopup);
let timePopupInput = null;  // 선택창이 지금 어느 시간칸에 붙어 있는지 (닫혀 있으면 null)

function makeTimeColumn(title, options) {
    const column = document.createElement("div");
    column.className = "time-column";
    const heading = document.createElement("div");
    heading.className = "time-column-title";
    heading.textContent = title;
    column.appendChild(heading);
    options.forEach(function (option) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "time-option";
        button.textContent = option.label;
        button.dataset[option.key] = option.value;
        column.appendChild(button);
    });
    return column;
}

// 지금 칸의 시간에 맞는 시/분 항목을 강조하고, 그 항목이 보이게 열을 스크롤한다
function refreshTimePopup() {
    if (!timePopupInput) {
        return;
    }
    const parsed = parseTimeText(timePopupInput.value);
    const [hour, minute] = parsed ? parsed.split(":").map(Number) : [null, null];
    [[timeHourColumn, "hour", hour], [timeMinuteColumn, "minute", minute]].forEach(function (entry) {
        const column = entry[0];
        let selected = null;
        column.querySelectorAll(".time-option").forEach(function (option) {
            const isSelected = Number(option.dataset[entry[1]]) === entry[2];
            option.classList.toggle("selected", isSelected);
            if (isSelected) {
                selected = option;
            }
        });
        if (selected) {
            column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.offsetHeight / 2;
        }
    });
}

function openTimePopup(input) {
    timePopupInput = input;
    timePopup.hidden = false;
    // 시간칸 바로 아래에 띄운다. 화면 아래가 모자라면 위로 띄운다
    const rect = input.closest(".time-field").getBoundingClientRect();
    const height = timePopup.offsetHeight;
    let top = rect.bottom + 4;
    if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - height - 4);
    }
    timePopup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - timePopup.offsetWidth - 8)) + "px";
    timePopup.style.top = top + "px";
    refreshTimePopup();
}

function closeTimePopup() {
    timePopup.hidden = true;
    timePopupInput = null;
}

// 선택창의 항목을 눌렀을 때: 시를 누르면 시만, 분을 누르면 분만 바꾼다. 분을 고르면 선택이 끝난 것이라 창을 닫는다
timePopup.addEventListener("click", function (event) {
    const option = event.target.closest(".time-option");
    if (!option || !timePopupInput) {
        return;
    }
    const [hour, minute] = (parseTimeText(timePopupInput.value) || "09:00").split(":").map(Number);
    const isHour = option.dataset.hour !== undefined;
    timePopupInput.value = padTwo(isHour ? Number(option.dataset.hour) : hour) + ":" + padTwo(isHour ? minute : Number(option.dataset.minute));
    timePopupInput.classList.remove("invalid");
    fireTimeChange(timePopupInput);  // 끝 시간이 따라 움직이도록 알린다
    refreshTimePopup();
    if (!isHour) {
        closeTimePopup();
    }
});

// 선택창을 눌러도 시간칸이 포커스를 잃지 않게 한다 (포커스를 잃으면 칸의 글자가 정리되면서 선택창이 어긋난다)
timePopup.addEventListener("mousedown", function (event) {
    event.preventDefault();
});

// 선택창 밖을 누르면 닫는다 (시계 아이콘은 스스로 열고 닫으므로 제외)
document.addEventListener("pointerdown", function (event) {
    if (!timePopup.hidden && !timePopup.contains(event.target) && !event.target.closest(".time-picker-button")) {
        closeTimePopup();
    }
}, true);
eventDialog.addEventListener("close", closeTimePopup);

// 시간칸 하나를 쓸 수 있게 만든다
function setupTimeField(input) {
    const button = input.closest(".time-field").querySelector(".time-picker-button");
    let justFocused = false;

    // 칸을 누르면 글자 전체가 선택되어서 바로 새로 타이핑할 수 있다.
    // (포커스 직후 마우스를 떼면 브라우저가 선택을 풀어 버리므로, 그 첫 mouseup만 막는다)
    input.addEventListener("focus", function () {
        justFocused = true;
        input.select();
    });
    input.addEventListener("mouseup", function (event) {
        if (justFocused) {
            event.preventDefault();
            justFocused = false;
        }
    });
    input.addEventListener("blur", function () {
        justFocused = false;
        commitTimeInput(input);
    });
    input.addEventListener("input", function () {
        input.classList.remove("invalid");
        if (timePopupInput === input) {
            refreshTimePopup();
        }
    });

    input.addEventListener("keydown", function (event) {
        if (event.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            // Enter = 이 시간을 확정한다. 확정되면 타이핑 모드에서 나온다(포커스를 내려놓는다). 그러면 다음 Enter는 "일정 저장"이 된다.
            // 읽을 수 없는 글자면 칸에 남아서 빨간 테두리로 알리고, 고칠 수 있게 한다
            event.preventDefault();
            closeTimePopup();
            if (commitTimeInput(input)) {
                input.blur();
            }
        } else if (event.key === "Escape" && timePopupInput === input) {
            // 선택창이 열려 있을 때의 Esc는 선택창만 닫는다 (일정 창까지 닫히지 않게)
            event.preventDefault();
            event.stopPropagation();
            closeTimePopup();
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            // ↑/↓: 5분씩, Shift와 함께면 1시간씩. 하루를 넘어가면 반대쪽 끝으로 돌아온다
            event.preventDefault();
            const [hour, minute] = (parseTimeText(input.value) || "09:00").split(":").map(Number);
            const step = (event.shiftKey ? 60 : 5) * (event.key === "ArrowUp" ? 1 : -1);
            const total = (((hour * 60 + minute + step) % 1440) + 1440) % 1440;
            input.value = padTwo(Math.floor(total / 60)) + ":" + padTwo(total % 60);
            input.classList.remove("invalid");
            fireTimeChange(input);
            refreshTimePopup();
        }
    });

    // 시계 아이콘: 선택창을 열고 닫는다
    button.addEventListener("mousedown", function (event) {
        event.preventDefault();  // 아이콘을 눌러도 시간칸의 포커스가 그대로 있게 한다
    });
    button.addEventListener("click", function () {
        if (timePopupInput === input) {
            closeTimePopup();
            return;
        }
        normalizeTimeInput(input);
        input.focus({ preventScroll: true });
        openTimePopup(input);
    });
}
setupTimeField(eventStartTime);
setupTimeField(eventEndTime);

// ---------- 시작 시간을 바꾸면 끝 시간도 같이 움직이기 / 길이 버튼 ----------
// Google Calendar처럼, 시작 날짜나 시간을 바꾸면 "일정의 길이"는 그대로 두고 끝도 같이 옮긴다.
// 예: 9시~10시(1시간)에서 시작을 11시로 바꾸면 끝이 12시가 된다. 끝을 직접 고치면 그 새 길이를 기억해서 다음에 시작을 바꿀 때 쓴다.
// "길이" 줄의 버튼(15분, 30분, 1시간 …)을 누르면 시작 + 그 길이로 끝이 정해진다.

let eventDurationMs = 60 * 60 * 1000;  // 지금 일정의 길이(끝 − 시작). 종일 일정은 "며칠"을 밀리초로 바꿔 둔 값이다
const durationChips = document.querySelectorAll(".duration-chip");

// 날짜 칸과 시간 칸을 읽어 Date로 만든다. 종일 일정은 날짜만 본다. 비었거나 읽을 수 없으면 null
function readEventDateTime(dateInput, timeInput) {
    if (!dateInput.value) {
        return null;
    }
    const [year, month, day] = dateInput.value.split("-").map(Number);
    if (eventAllDayCheckbox.checked) {
        return new Date(year, month - 1, day);
    }
    const time = parseTimeText(timeInput.value);
    if (!time) {
        return null;
    }
    const [hour, minute] = time.split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute);
}

// 지금 끝 − 시작과 같은 길이의 버튼을 강조한다
function updateDurationChips() {
    const start = readEventDateTime(eventStartDate, eventStartTime);
    const end = readEventDateTime(eventEndDate, eventEndTime);
    const actual = start && end ? end - start : null;
    durationChips.forEach(function (chip) {
        chip.classList.toggle("active", actual !== null && actual === Number(chip.dataset.minutes) * 60000);
    });
}

// 끝(날짜, 시간)을 직접 고쳤거나 창을 막 열었을 때: 지금의 끝 − 시작을 "일정의 길이"로 기억한다.
// 끝이 시작보다 빠르거나 읽을 수 없는 동안에는 기억해 둔 길이를 그대로 둔다
function updateDurationFromFields() {
    const start = readEventDateTime(eventStartDate, eventStartTime);
    const end = readEventDateTime(eventEndDate, eventEndTime);
    if (start && end) {
        if (eventAllDayCheckbox.checked) {
            if (end >= start) {
                eventDurationMs = Math.round((end - start) / 86400000) * 86400000;  // 서머타임 같은 1시간 오차는 반올림이 지운다
            }
        } else if (end > start) {
            eventDurationMs = end - start;
        }
    }
    updateDurationChips();
}

// 시작이 바뀌었을 때: 끝 = 시작 + 기억해 둔 길이
function moveEndWithStart() {
    const start = readEventDateTime(eventStartDate, eventStartTime);
    if (!start) {
        return;  // 시작이 비었거나 읽을 수 없는 동안에는 끝을 건드리지 않는다
    }
    if (eventAllDayCheckbox.checked) {
        eventEndDate.value = addDaysToText(eventStartDate.value, Math.round(eventDurationMs / 86400000));
    } else {
        const end = new Date(start.getTime() + eventDurationMs);
        eventEndDate.value = toDateText(end);   // 자정을 넘기면 끝 날짜도 다음 날로 바뀐다
        eventEndTime.value = toTimeText(end);
        eventEndTime.classList.remove("invalid");
    }
    updateDurationChips();
}

eventStartDate.addEventListener("change", moveEndWithStart);
eventStartTime.addEventListener("change", moveEndWithStart);
eventEndDate.addEventListener("change", updateDurationFromFields);
eventEndTime.addEventListener("change", updateDurationFromFields);

durationChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
        if (!readEventDateTime(eventStartDate, eventStartTime)) {
            eventError.textContent = "시작 날짜와 시간을 먼저 입력하세요.";
            return;
        }
        eventError.textContent = "";
        eventDurationMs = Number(chip.dataset.minutes) * 60000;
        moveEndWithStart();
    });
});

// 종일이면 시간 칸과 길이 버튼을 숨긴다
function updateTimeInputs() {
    eventStartTime.closest(".time-field").hidden = eventAllDayCheckbox.checked;
    eventEndTime.closest(".time-field").hidden = eventAllDayCheckbox.checked;
    document.querySelector(".duration-row").hidden = eventAllDayCheckbox.checked;
    updateDurationFromFields();  // 종일 ↔ 시간 있는 일정을 오가면 길이를 그 방식으로 다시 읽는다
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
    eventMemoInitial = memoText(values.description);
    eventMemoInput.value = eventMemoInitial;
    eventAllDayCheckbox.checked = values.allDay;
    eventStartDate.value = values.startDate;
    eventStartTime.value = values.startTime;
    eventStartTime.dataset.committed = values.startTime;
    eventEndTime.dataset.committed = values.endTime;
    eventStartTime.classList.remove("invalid");
    eventEndTime.classList.remove("invalid");
    closeTimePopup();
    eventEndDate.value = values.endDate;
    eventEndTime.value = values.endTime;
    // 수정할 때는 일정이 속한 캘린더가 선택되어 있고, 다른 캘린더를 고르면 저장할 때 그 캘린더로 옮겨진다.
    // 새 일정은 기본 캘린더가 미리 선택되고, 직접 바꿀 수 있다
    eventCalendarSelect.value = values.calendarId || defaultCalendarId;
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
    if (info.view.type === MONTH_VIEW) {
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
        description: event.extendedProps.description,
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

    // 칸에 쓴 글자를 "14:30" 모양으로 읽는다 (칸을 떠나기 전에 바로 저장 버튼을 눌러도 안전하도록 여기서도 한 번 더 읽는다)
    const startTime = normalizeTimeInput(eventStartTime);
    const endTime = normalizeTimeInput(eventEndTime);
    if (!eventStartTime.value.trim() || !eventEndTime.value.trim()) {
        throw new Error("시간을 입력하세요.");
    }
    if (!startTime || !endTime) {
        throw new Error("시간을 읽을 수 없습니다. 14:30 처럼 적어 주세요.");
    }
    const start = startDate + "T" + startTime;
    const end = endDate + "T" + endTime;
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
            const body = {
                calendarId: editingEvent.extendedProps.calendarId,
                title: title,
                ...timeFields,
            };
            // 메모는 창을 연 뒤 고쳤을 때만 보낸다. 다 지웠으면 빈 글자("")를 보내서 메모를 지운다
            if (eventMemoInput.value.trim() !== eventMemoInitial) {
                body.description = eventMemoInput.value.trim();
            }
            // 다른 캘린더를 골랐으면 서버가 내용을 고친 뒤 그 캘린더로 옮긴다
            const moved = eventCalendarSelect.value && eventCalendarSelect.value !== editingEvent.extendedProps.calendarId;
            if (moved) {
                body.destinationCalendarId = eventCalendarSelect.value;
            }
            await sendRequest("/api/events/" + encodeURIComponent(editingEvent.id), "PATCH", body);
            if (moved) {
                showToast("'" + title + "' 일정을 '" + eventCalendarSelect.selectedOptions[0].textContent + "' 캘린더로 옮겼습니다");
            }
        } else {
            const body = {
                calendarId: eventCalendarSelect.value,
                title: title,
                ...timeFields,
            };
            if (eventMemoInput.value.trim()) {
                body.description = eventMemoInput.value.trim();
            }
            await sendRequest("/api/events", "POST", body);
        }

        eventDialog.close();
        calendar.refetchEvents();  // Google에서 일정을 다시 불러와서 화면을 맞춘다
        reloadTimelineIfVisible();  // 오늘 탭의 시간표에서 연 창이었다면 시간표도 새 내용으로
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
        reloadTimelineIfVisible();
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
// 일정 창에서 Enter를 누르면:
//  - 제목 칸: 일정을 저장하고 창을 닫는다 (다른 입력 창들과 같다)
//  - 시간 칸: 그 시간을 확정하고 타이핑 모드에서 나온다 (시간칸 자신의 처리. 위의 setupTimeField)
//  - 날짜 칸: 마찬가지로 입력을 확정하고 타이핑 모드에서 나온다
//  - 버튼, 선택 칸(캘린더)에서: 그 버튼/선택 칸 본래의 동작
//  - 그 밖에, 어느 칸에서도 타이핑하고 있지 않을 때(종일 체크 뒤나 빈 곳 등): 일정을 저장하고 창을 닫는다
// 그래서 "시간 입력 → Enter(확정) → Enter(저장)"으로 이어진다.
// 한글을 조합하는 중의 Enter는 글자를 확정하는 키라서 건드리지 않는다 (제목의 마지막 글자를 확정하다가 저장돼 버리지 않게)
document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || e.isComposing || e.repeat || !eventDialog.open) {
        return;
    }
    const target = e.target;
    if (target.closest && target.closest(".time-field")) {
        return;  // 시간칸과 시계 아이콘은 자기 처리가 있다
    }
    if (["BUTTON", "SELECT", "TEXTAREA"].includes(target.tagName)) {
        return;
    }
    e.preventDefault();
    if (target.tagName === "INPUT" && target.type === "date") {
        target.blur();  // 날짜 입력을 확정하고 타이핑 모드에서 나온다
        return;
    }
    if (!eventSaveButton.disabled) {  // 저장/삭제 요청이 진행 중일 때 Enter를 또 눌러도 중복으로 저장하지 않는다
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
        description: memoText(event.extendedProps.description),  // 메모도 함께 복사한다 (서식은 빼고 글자만)
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
        const body = {
            calendarId: copiedEvent.calendarId || defaultCalendarId,
            title: copiedEvent.title,
            allDay: copiedEvent.allDay,
            start: start,
            end: end,
        };
        if (copiedEvent.description) {
            body.description = copiedEvent.description;
        }
        await sendRequest("/api/events", "POST", body);
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
const todayTasksList = document.getElementById("today-tasks");
const overdueSection = document.getElementById("overdue-section");
const overdueTasksList = document.getElementById("overdue-tasks");
const taskInput = document.getElementById("task-input");
const taskAddButton = document.getElementById("task-add-button");
const taskProjectSelect = document.getElementById("task-project");
const tasksHeading = document.getElementById("tasks-heading");
const dayPrevButton = document.getElementById("day-prev");
const dayNextButton = document.getElementById("day-next");
const dayTodayButton = document.getElementById("day-today");
const tasksColumn = document.getElementById("tasks-column");
const inboxColumn = document.getElementById("inbox-column");
const inboxList = document.getElementById("inbox-tasks");
const inboxInput = document.getElementById("inbox-input");
const inboxAddButton = document.getElementById("inbox-add-button");
const inboxCount = document.getElementById("inbox-count");

// 진짜 오늘 날짜("2026-10-19"). 탭을 열 때마다 새로 구한다. 켜둔 채 자정을 넘길 수도 있기 때문이다
let todayText = toDateText(new Date());
// 지금 화면이 보여주는 날짜. 탭을 처음 열면 오늘이고, ◀ ▶로 바꿀 수 있다. 일정, 할 일, 새 할 일 추가가 모두 이 날짜를 따른다
let viewedDate = todayText;
// 달력에서 할 일 요약을 눌러 "이 날짜로 오늘 탭을 열어 달라"고 했을 때, 탭이 열리면서 그 날짜를 보여주도록 잠깐 담아 두는 곳
let pendingTodayDate = null;

// 오늘 탭을 열고 dateText(예: "2026-10-25")의 일정과 할 일을 보여준다
function openTodayOn(dateText) {
    pendingTodayDate = dateText;
    document.querySelector("[data-tab=today]").click();
}

// 목록(<ul>)에 "내용이 없을 때" 보여줄 회색 안내 문장 한 줄을 넣는다
function showEmptyMessage(listElement, message) {
    const item = document.createElement("li");
    item.className = "today-empty";
    item.textContent = message;
    listElement.appendChild(item);
}

// ----- 시간표 (오늘 탭 왼쪽) -----
// 그날의 Google 일정(옅은 색 블록)과 "내 계획"(점선 블록)을 24시간 눈금 위에 놓는다. 지금 보고 있는 날짜(viewedDate)를 따라간다.
//  - 일정은 /api/events에서, 계획은 /api/time-blocks에서 받는다. 계획은 내 컴퓨터에만 저장하고 Google에는 보내지 않는다.
//  - 일정과 계획이 겹치면 폭을 나눠 나란히 놓는다(layoutOverlaps).
//  - 빈 곳을 끌면 그 시간만큼의 계획이 만들어지고(한 번 누르기만 하면 1시간), 제목을 적고 Enter를 누르면 저장된다.
//  - 계획 블록은 끌어서 옮기고, 아래쪽 끝을 끌어서 길이를 바꾼다. 15분 단위로 맞춰진다.
//  - 오늘 할 일(또는 할 일 목록)의 할 일을 시간표로 끌어다 놓으면 그 할 일과 연결된 계획이 만들어진다.
//  - 블록을 누르면 작은 창이 뜬다. 일정이면 메모를 바로 쓰고(Enter 저장, Shift+Enter 줄바꿈), 계획이면 제목을 고치거나 지운다.
// 달력(FullCalendar)을 쓰지 않고 직접 만든 이유: 일정과 계획을 한 화면에 섞어 겹침까지 배치해야 하고,
// 할 일 끌어다 놓기가 이미 있는 포인터 이벤트 방식(beginTaskDrag)과 한 몸으로 움직여야 해서다.

// 시간표 확대/축소: 터치패드에서 두 손가락을 벌리거나 오므리면(브라우저에는 Ctrl+휠로 전달된다), 또는 [+] [−] 버튼으로 시간표를 늘이고 줄인다.
// 한 시간의 세로 길이가 커질수록 블록을 더 잘게 맞출 수 있어서, 충분히 확대하면 5분 단위, 그보다 작으면 15분 단위로 맞춰진다.
const TL_HOUR_MIN = 36;          // 가장 축소했을 때 한 시간의 세로 길이(px). 서버(settings_store.py)와 같은 값
const TL_HOUR_MAX = 160;         // 가장 확대했을 때. 서버와 같은 값
const TL_HOUR_DEFAULT = 64;      // 처음 값 (처음에 42px로 만들었는데 사용자가 너무 작다고 해서 키웠다). 서버와 같은 값
const TL_FINE_HOUR_PX = 120;     // 이만큼 확대하면 5분 단위로 맞춘다 (5분이 10px 이상이 되는 크기)
const TL_HALF_LINES_PX = 84;     // 이만큼 확대하면 30분 눈금(옅은 줄과 글자)도 보여준다
const TL_QUARTER_LINES_PX = 120; // 이만큼 확대하면 15분 줄도 보여준다
const TL_SCROLL_PAD = 10;        // .tl-scroll의 위쪽 안쪽 여백(px). style.css와 같은 값
let tlHourPx = TL_HOUR_DEFAULT;  // 지금 한 시간의 세로 길이(px). 두 손가락 동작은 조금씩 변하므로 소수일 수 있다

const TL_DEFAULT_LENGTH = 60;    // 빈 곳을 한 번 누르거나 할 일을 끌어다 놓았을 때 만들어지는 길이(분)
const TL_DAY_MIN = 24 * 60;      // 하루의 분
const TL_MIN_VISIBLE_PX = 16;    // 아주 짧은 블록도 눌러 볼 수 있게 보장하는 최소 높이(px). 기본 확대(64px/시간)에서 15분이 딱 이 높이다

const timelineScroll = document.getElementById("timeline-scroll");
const timelineEl = document.getElementById("timeline");
const timelineLabels = document.getElementById("timeline-labels");
const timelineGrid = document.getElementById("timeline-grid");
const timelineAllDay = document.getElementById("timeline-allday");
const timelineZoomIn = document.getElementById("tl-zoom-in");
const timelineZoomOut = document.getElementById("tl-zoom-out");
const timelineSnapLabel = document.getElementById("tl-snap");

// 블록을 만들고 옮길 때 맞추는 단위(분)이자 끌어서 줄일 수 있는 가장 짧은 길이. 확대한 정도에 따라 5분 또는 15분이다
function snapStep() {
    return tlHourPx >= TL_FINE_HOUR_PX ? 5 : 15;
}

// 시간 눈금 글자를 만든다. 한 시간마다 있고, 충분히 확대하면 30분마다 작은 글자도 붙는다. 확대 정도가 바뀔 때마다 다시 만든다
function buildTimelineLabels() {
    timelineLabels.replaceChildren();
    function addLabel(min, minor) {
        const label = document.createElement("span");
        label.textContent = minToText(min);
        label.style.top = (min / 60 * tlHourPx) + "px";
        if (minor) {
            label.className = "tl-label-minor";
        }
        timelineLabels.appendChild(label);
    }
    for (let hour = 0; hour <= 24; hour++) {
        addLabel(hour * 60, false);
        if (hour < 24 && tlHourPx >= TL_HALF_LINES_PX) {
            addLabel(hour * 60 + 30, true);
        }
    }
}

// 지금 시간표가 보여주는 내용. date는 이 내용이 어느 날짜의 것인지, request는 가장 최근 요청의 번호(늦게 온 옛 응답을 버리려는 것)다
const timeline = { date: null, events: [], plans: [], eventsFailed: false, needScroll: false, request: 0 };
let timelineDrag = null;        // 끄는 중에만 값이 있다
let timelinePopover = null;     // 블록을 눌러 연 작은 창이 있으면 { el, key, onClose }
const EVENT_MEMO_SAVE_DELAY_MS = 1500;
const EVENT_MEMO_MAX = 8000;    // 서버(app.py의 EVENT_DESCRIPTION_MAX)와 같은 값
let pendingEventMemoSaves = 0;  // 지금 Google에 보내는 중인 메모 저장 개수

// ----- 작은 도구들 -----

// 0시부터의 분 → "16:30" (1440분은 "24:00")
function minToText(min) {
    return pad(Math.floor(min / 60)) + ":" + pad(min % 60);
}

// 길이(분) → "1시간 30분"
function durationText(min) {
    const hours = Math.floor(min / 60);
    const minutes = min % 60;
    return (hours ? hours + "시간" : "") + (hours && minutes ? " " : "") + (minutes ? minutes + "분" : "");
}

function clampNumber(value, low, high) {
    return Math.max(low, Math.min(high, value));
}

// 분 → 시간표 안에서의 세로 위치(px)와 그 반대
function minToY(min) {
    return min / 60 * tlHourPx;
}

// 화면의 세로 위치(clientY)가 시간표의 몇 분째를 가리키는지. 스크롤된 만큼은 getBoundingClientRect가 알아서 반영한다
function yToMin(clientY) {
    return (clientY - timelineGrid.getBoundingClientRect().top) / tlHourPx * 60;
}

function floorSnap(min) {
    return Math.floor(min / snapStep()) * snapStep();
}

function ceilSnap(min) {
    return Math.ceil(min / snapStep()) * snapStep();
}

function roundSnap(min) {
    return Math.round(min / snapStep()) * snapStep();
}

// ----- 확대/축소 -----

// 확대 정도(tlHourPx)를 화면에 반영한다: 눈금 간격(CSS 변수), 30분/15분 줄, 눈금 글자, "15분 단위" 표시, 버튼
function applyTimelineZoomVisuals() {
    timelineEl.style.setProperty("--tl-hour", tlHourPx + "px");
    timelineEl.classList.toggle("tl-half", tlHourPx >= TL_HALF_LINES_PX);
    timelineEl.classList.toggle("tl-quarter", tlHourPx >= TL_QUARTER_LINES_PX);
    buildTimelineLabels();
    timelineSnapLabel.textContent = snapStep() + "분 단위";
    timelineZoomIn.disabled = tlHourPx >= TL_HOUR_MAX;
    timelineZoomOut.disabled = tlHourPx <= TL_HOUR_MIN;
}
applyTimelineZoomVisuals();

let timelineZoomSaveTimer = null;

// 한 시간의 길이를 px로 바꾼다. anchorClientY(화면의 세로 위치)가 있으면 그 자리의 시각이 제자리에 있도록 스크롤을 맞춘다
// (손가락을 벌린 자리가 그대로 있고 주변이 늘어나는 것처럼 보이게). save가 true면 확대 정도를 설정에 저장한다
function setTimelineZoom(px, anchorClientY, save) {
    const next = clampNumber(px, TL_HOUR_MIN, TL_HOUR_MAX);
    if (next === tlHourPx) {
        return;
    }
    closeTimelinePopover();
    const anchorMin = anchorClientY === undefined ? null : yToMin(anchorClientY);
    tlHourPx = next;
    applyTimelineZoomVisuals();
    renderTimeline();  // 블록의 위치와 크기를 새 눈금에 맞춰 다시 그린다
    if (anchorMin !== null) {
        const offset = anchorClientY - timelineScroll.getBoundingClientRect().top - TL_SCROLL_PAD;
        timelineScroll.scrollTop = minToY(anchorMin) - offset;
    }
    if (save) {
        // 두 손가락 동작은 이벤트가 쏟아지므로, 멈추고 0.6초 뒤에 한 번만 저장한다
        clearTimeout(timelineZoomSaveTimer);
        timelineZoomSaveTimer = setTimeout(function () {
            settings.timelineHourPx = Math.round(tlHourPx);
            saveSettings();
        }, 600);
    }
}

// 시간표 위에서 Ctrl+휠(터치패드의 두 손가락 벌리기/오므리기): 확대/축소. 마우스 휠은 한 칸에 deltaY가 100쯤 와서 너무 크게 변하므로 ±30으로 제한한다.
// 끄는 중에는 무시한다(끌던 블록의 위치가 어긋나지 않게). Ctrl 없이 굴리면 평소처럼 스크롤된다
timelineScroll.addEventListener("wheel", function (e) {
    if (!e.ctrlKey) {
        return;
    }
    e.preventDefault();  // 앱 전체가 확대되는 브라우저의 기본 동작을 막는다
    if (timelineDrag) {
        return;
    }
    const delta = clampNumber(e.deltaY, -30, 30);
    setTimelineZoom(tlHourPx * Math.exp(-delta * 0.008), e.clientY, true);
}, { passive: false });

// [+] [−] 버튼: 한 번에 25%씩. 보이는 영역의 한가운데를 기준으로 늘이고 줄인다
function zoomTimelineByButton(factor) {
    const rect = timelineScroll.getBoundingClientRect();
    setTimelineZoom(tlHourPx * factor, rect.top + rect.height / 2, true);
}
timelineZoomIn.addEventListener("click", function () {
    zoomTimelineByButton(1.25);
});
timelineZoomOut.addEventListener("click", function () {
    zoomTimelineByButton(0.8);
});

// 저장해 둔 확대 정도를 불러온다. 프로그램을 켠 뒤 처음 오늘 탭을 열 때 한 번만 한다
// (탭을 열 때마다 하면, 방금 확대하고 저장이 끝나기 전에 탭을 옮겼을 때 옛 값으로 되돌아간다)
let timelineZoomLoaded = false;
function loadTimelineZoom() {
    if (timelineZoomLoaded) {
        return;
    }
    timelineZoomLoaded = true;
    const saved = settings.timelineHourPx;
    if (typeof saved === "number") {
        setTimelineZoom(saved, undefined, false);
    }
}

// "2026-10-28" → 이 컴퓨터 시간대의 그날 0시 (new Date("2026-10-28")은 UTC로 읽혀 하루 어긋날 수 있어서 직접 만든다)
function dateFromText(text) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day);
}

// 시간 있는 일정을 그날 0시부터의 (시작, 끝) 분으로 바꾼다. 하루를 넘나드는 일정은 그날 안으로 잘라서 본다
function eventMinutes(event, dateText) {
    const dayStart = dateFromText(dateText).getTime();
    const start = Math.round((new Date(event.start).getTime() - dayStart) / 60000);
    const end = Math.round((new Date(event.end).getTime() - dayStart) / 60000);
    return { start: clampNumber(start, 0, TL_DAY_MIN), end: clampNumber(end, 0, TL_DAY_MIN) };
}

// Google 일정 데이터를 일정 수정 창(openEditDialog)이 알아보는 모양(FullCalendar의 일정 객체와 같은 이름들)으로 바꿔 준다
function eventAsCalendarEvent(event) {
    const allDay = event.start.length === 10;
    return {
        id: event.id,
        title: event.title,
        allDay: allDay,
        start: allDay ? dateFromText(event.start) : new Date(event.start),
        end: allDay ? dateFromText(event.end) : new Date(event.end),
        extendedProps: { calendarId: event.calendarId, canEdit: event.canEdit, description: event.description },
    };
}

// ----- 겹침 배치 -----
// 시간이 겹치는 블록들을 한 묶음으로 보고, 묶음 안에서 겹치지 않게 칸(열)을 나눠 준다.
// 예: 둘이 겹치면 각각 폭의 절반, 셋이 한꺼번에 겹치면 3분의 1. 겹치지 않는 블록은 폭을 다 쓴다.
// 각 item에 col(몇 번째 칸)과 cols(그 묶음이 몇 칸으로 나뉘는지)을 채워 넣는다.
// "겹친다"의 기준은 시간이 아니라 **실제로 화면에 그려지는 크기**다. 19:15에 끝나는 블록과 19:15에 시작하는 블록은 붙어서 나란히 이어지고(분할하지 않는다),
// 짧은 블록은 최소 높이(TL_MIN_VISIBLE_PX)로 그려지므로 그 높이만큼은 차지하는 것으로 본다(그래야 그 아래 블록이 짧은 블록의 글자를 가리지 않는다).
// 확대/축소하면 같은 5분도 그려지는 높이가 달라지므로, 시간표를 다시 그릴 때마다 지금 크기로 계산한다.
// (처음에는 글자 크기를 신경 쓰느라 "짧은 블록은 무조건 30분으로 본다"고 했는데, 그러면 10분 떨어진 블록까지 분할돼서 너무 널널했다)
function layoutOverlaps(items) {
    const minVisibleMin = TL_MIN_VISIBLE_PX / tlHourPx * 60;  // 최소 높이를 분으로 바꾼 값
    items.forEach(function (item) {
        item.layoutEnd = Math.max(item.end, item.start + minVisibleMin);
    });
    items.sort(function (a, b) {
        return a.start - b.start || b.end - a.end;
    });

    let cluster = [];
    let clusterEnd = -1;
    let columnEnds = [];  // 각 칸이 마지막으로 차지한 끝 시각
    function closeCluster() {
        cluster.forEach(function (item) {
            item.cols = columnEnds.length;
        });
    }
    items.forEach(function (item) {
        if (item.start >= clusterEnd) {  // 앞 묶음과 이어지지 않으면 새 묶음을 시작한다
            closeCluster();
            cluster = [];
            columnEnds = [];
        }
        let column = columnEnds.findIndex(function (end) {
            return end <= item.start;
        });
        if (column === -1) {
            column = columnEnds.length;
            columnEnds.push(0);
        }
        columnEnds[column] = item.layoutEnd;
        item.col = column;
        cluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.layoutEnd);
    });
    closeCluster();
}

// 블록 높이에 맞춰 글자를 조금 줄인다: 블록이 짧으면(5분처럼 짧은 시간이거나 많이 축소했을 때) 제목이 블록 밖으로 잘리지 않도록
// 24px 아래에서는 높이에 비례해 줄이되 최소 80%까지만 줄인다(많이 줄이면 안 읽힌다). 아주 짧으면 위아래 여백과 줄 간격도 줄인다
function fitBlockText(element, heightPx) {
    element.style.setProperty("--tl-fs", clampNumber(heightPx / 24, 0.8, 1));
    element.classList.toggle("tl-short", heightPx < 24);
}

// 블록의 위치와 크기를 정한다 (세로는 시간, 가로는 겹침 배치)
function placeBlock(element, item) {
    const height = Math.max(minToY(item.end - item.start), TL_MIN_VISIBLE_PX);
    element.style.top = minToY(item.start) + "px";
    element.style.height = height + "px";
    fitBlockText(element, height);
    const width = 100 / (item.cols || 1);
    element.style.left = "calc(" + (item.col || 0) * width + "% + 2px)";
    element.style.width = "calc(" + width + "% - 4px)";
}

// ----- 불러오기와 그리기 -----

// 보고 있는 날짜의 일정과 계획을 받아서 그린다. 계획은 내 컴퓨터에서 바로 오고 일정은 Google을 거쳐 느릴 수 있어서 따로 기다린다.
// 인터넷이 끊겨 일정을 못 받아도 계획은 보인다
async function loadTimeline() {
    const date = viewedDate;
    const request = ++timeline.request;
    async function getJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(await errorMessageFrom(response));
        }
        return response.json();
    }
    const [eventsResult, plansResult] = await Promise.allSettled([
        getJson("/api/events?start=" + date + "&end=" + addDaysToText(date, 1)),
        getJson("/api/time-blocks?date=" + date),
    ]);
    if (request !== timeline.request || date !== viewedDate) {
        return;  // 그 사이 다른 날로 넘어갔거나 더 새 요청이 있다
    }
    timeline.date = date;
    if (plansResult.status === "fulfilled") {
        timeline.plans = plansResult.value;
    } else {
        timeline.plans = [];
        showToast("계획을 불러오지 못했습니다: " + plansResult.reason.message);
    }
    if (eventsResult.status === "fulfilled") {
        // 캘린더 탭에서 체크를 꺼둔 캘린더의 일정은 여기서도 보이지 않게 한다
        timeline.events = eventsResult.value.filter(function (event) {
            return !hiddenCalendarIds.has(event.calendarId);
        });
        timeline.eventsFailed = false;
    } else {
        console.error("일정을 불러오지 못했습니다:", eventsResult.reason);
        timeline.events = [];
        timeline.eventsFailed = true;
    }
    renderTimeline();
}

// 계획만 다시 받는다 (계획을 만들거나 고친 뒤. Google 일정은 그대로이므로 다시 받지 않는다)
async function reloadPlans() {
    const date = viewedDate;
    try {
        const response = await fetch("/api/time-blocks?date=" + date);
        if (!response.ok) {
            throw new Error(await errorMessageFrom(response));
        }
        const plans = await response.json();
        if (date !== viewedDate) {
            return;
        }
        timeline.date = date;
        timeline.plans = plans;
    } catch (error) {
        showToast("계획을 불러오지 못했습니다: " + error.message);
    }
    renderTimeline();
}

// 시간표와 할 일 목록을 함께 다시 불러온다 (reloadTodayAndInbox가 계획도 불러오므로 같은 일이다. 시간표 쪽 코드에서 읽기 쉽게 이름을 따로 둔다)
async function reloadTodayAndTimeline() {
    await reloadTodayAndInbox();
}

// 달력 탭에서 연 일정 수정 창이 저장/삭제된 뒤, 오늘 탭이 열려 있으면 시간표도 새 내용으로 맞춘다
function reloadTimelineIfVisible() {
    if (document.getElementById("today").classList.contains("active")) {
        loadTimeline().catch(function (error) {
            console.error("시간표를 불러오지 못했습니다:", error);
        });
    }
}

// 지금 쓰는 중이거나 끄는 중이면 true. 이때 동기화가 시간표를 다시 그리면 쓰던 글과 끌던 블록이 사라지므로 그 새로고침은 건너뛴다
function isTimelineBusy() {
    return timelineDrag !== null || timelinePopover !== null || pendingEventMemoSaves > 0 ||
        timelineGrid.querySelector(".tl-creating") !== null;
}

// 지금 내용(timeline)을 화면에 그린다
function renderTimeline() {
    timelineGrid.replaceChildren();
    timelineAllDay.replaceChildren();

    const allDay = [];
    const items = [];
    timeline.events.forEach(function (event) {
        if (event.start.length === 10) {
            allDay.push(event);
            return;
        }
        const range = eventMinutes(event, timeline.date);
        if (range.end <= range.start) {
            return;  // 그날 안에는 시간이 남지 않는 일정(전날 밤에 끝난 일정 등)
        }
        items.push({ kind: "event", data: event, start: range.start, end: range.end });
    });
    timeline.plans.forEach(function (plan) {
        items.push({ kind: "plan", data: plan, start: plan.start, end: plan.end });
    });
    layoutOverlaps(items);

    allDay.forEach(function (event) {
        timelineAllDay.appendChild(makeEventBlock(event, null));
    });
    if (timeline.eventsFailed) {
        const note = document.createElement("span");
        note.className = "today-empty";
        note.textContent = "일정을 불러오지 못했습니다.";
        timelineAllDay.appendChild(note);
    }
    timelineAllDay.hidden = allDay.length === 0 && !timeline.eventsFailed;

    items.forEach(function (item) {
        const block = item.kind === "event" ? makeEventBlock(item.data, item) : makePlanBlock(item.data, item);
        placeBlock(block, item);
        timelineGrid.appendChild(block);
    });

    // 작은 창이 열려 있는 블록은 계속 표시해 둔다
    if (timelinePopover) {
        const open = timelineGrid.querySelector('[data-key="' + timelinePopover.key + '"]') ||
            timelineAllDay.querySelector('[data-key="' + timelinePopover.key + '"]');
        if (open) {
            open.classList.add("selected");
            timelinePopover.anchor = open;  // 블록이 새로 만들어졌으니, 창이 따라갈 블록도 새것으로 바꾼다
        }
    }

    updateNowLine();
    refreshTaskSlots();
    if (timeline.needScroll && timelineScroll.clientHeight > 0) {
        scrollTimelineToDefault();
    }
}

// 처음 열었을 때(또는 날짜를 바꿨을 때) 보여줄 위치: 오늘이면 지금 시각이 위에서 3분의 1쯤에, 다른 날이면 07:00이 맨 위에 오게 한다
function scrollTimelineToDefault() {
    timeline.needScroll = false;
    let top;
    if (timeline.date === toDateText(new Date())) {
        const now = new Date();
        top = minToY(now.getHours() * 60 + now.getMinutes()) - timelineScroll.clientHeight / 3;
    } else {
        top = minToY(7 * 60);
    }
    timelineScroll.scrollTop = Math.max(0, top);
}

// 지금 시각을 가리키는 빨간 줄 (오늘을 볼 때만)
function updateNowLine() {
    timelineGrid.querySelectorAll(".tl-now").forEach(function (line) {
        line.remove();
    });
    if (timeline.date !== toDateText(new Date())) {
        return;
    }
    const now = new Date();
    const line = document.createElement("div");
    line.className = "tl-now";
    line.style.top = minToY(now.getHours() * 60 + now.getMinutes()) + "px";
    timelineGrid.appendChild(line);
}
setInterval(function () {
    if (document.getElementById("today").classList.contains("active")) {
        updateNowLine();
        checkDayRollover();
    }
}, 60000);
// 노트북을 덮었다 열거나 최소화했던 창을 다시 열었을 때는 1분 타이머를 기다리지 않고 바로 확인한다
document.addEventListener("visibilitychange", function () {
    if (!document.hidden && document.getElementById("today").classList.contains("active")) {
        checkDayRollover();
    }
});

// 오늘 탭을 켜 둔 채 자정이 지나면 "오늘"이 바뀐다. todayText는 탭을 열 때만 새로 구하므로, 그냥 두면 어제가 계속 "오늘 할 일"로 보인다
// (그리고 빨간 현재 시각 줄도 사라진다). 날짜가 바뀐 것을 알아채면 오늘 탭을 다시 열 때와 똑같이 새로 불러온다.
function checkDayRollover() {
    if (toDateText(new Date()) === todayText) {
        return;
    }
    // 글자를 쓰는 중이거나 시간표를 끄는 중이면 건드리지 않고 다음 확인 때 다시 본다.
    // 메모를 쓰다가 갑자기 다음 날의 빈 메모 칸으로 바뀌면 안 되기 때문이다. (할 일 입력 칸은 화면을 다시 그려도 지워지지 않으므로 제외한다)
    const active = document.activeElement;
    const typing = active && document.getElementById("today").contains(active) &&
        active.id !== "task-input" && active.id !== "inbox-input" &&
        (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && active.type === "text"));
    if (typing || isTimelineBusy()) {
        return;
    }
    // 어제를 "오늘"로 보고 있었으면 새 오늘로 따라가고, 다른 날을 보고 있었으면 그 날짜를 그대로 둔다.
    // 어느 쪽이든 loadToday가 오늘 날짜(todayText)를 새로 구하고 제목, 버튼, 밀린 할 일, D-day를 새 오늘 기준으로 맞춘다
    pendingTodayDate = viewedDate === todayText ? null : viewedDate;
    loadToday().catch(function (error) {
        console.error("날짜가 바뀐 뒤 오늘 탭을 새로 불러오지 못했습니다:", error);
    });
}

// 오늘 할 일 줄 옆에 "16:30–18:30"을 붙인다 (시간표에 배치한 할 일이라는 표시). 시간표나 할 일 목록을 다시 그릴 때마다 맞춘다
function refreshTaskSlots() {
    const plansByTask = {};
    if (timeline.date === viewedDate) {
        timeline.plans.forEach(function (plan) {
            if (plan.taskId !== null) {
                (plansByTask[plan.taskId] = plansByTask[plan.taskId] || []).push(plan);
            }
        });
    }
    [todayTasksList, overdueTasksList].forEach(function (list) {
        list.querySelectorAll(".task-row[data-task-id]").forEach(function (row) {
            row.querySelectorAll(".task-slot").forEach(function (old) {
                old.remove();
            });
            const plans = plansByTask[row.dataset.taskId];
            const anchor = row.querySelector(".task-content, .task-edit-input");
            if (!plans || !anchor) {
                return;
            }
            plans.sort(function (a, b) {
                return a.start - b.start;
            });
            const slot = document.createElement("span");
            slot.className = "task-slot";
            slot.textContent = minToText(plans[0].start) + "–" + minToText(plans[0].end) + (plans.length > 1 ? " 외 " + (plans.length - 1) : "");
            anchor.after(slot);
        });
    });
}

// ----- 블록 만들기 -----

// Google 일정 블록. item이 null이면 종일 일정(시간표 위의 알약)이다
function makeEventBlock(event, item) {
    const block = document.createElement("div");
    block.className = "tl-block tl-event";
    block.style.setProperty("--c", event.color);
    block.dataset.key = "e:" + event.id;

    const title = document.createElement("div");
    title.className = "tl-title";
    title.textContent = event.title;  // textContent: 제목에 < > 같은 글자가 있어도 HTML로 해석되지 않는다
    block.appendChild(title);

    const memo = memoText(event.description);
    let timeText = "종일";
    if (item) {
        timeText = minToText(item.start) + "–" + minToText(item.end);
        if (item.end - item.start >= 60) {  // 한 시간 이상이어야 시간 글자가 들어갈 자리가 있다
            const time = document.createElement("div");
            time.className = "tl-time";
            time.textContent = timeText;
            block.appendChild(time);
        }
    }
    if (memo) {
        const memoLine = document.createElement("div");
        memoLine.className = "tl-memo";
        memoLine.textContent = memo;
        block.appendChild(memoLine);
    }
    // 마우스를 올리면 전체 제목, 시간, 메모가 툴팁으로 뜬다 (블록이 작아 글자가 잘려도 읽을 수 있게)
    block.title = timeText + "  " + event.title + (memo ? "\n\n" + (memo.length > 200 ? memo.slice(0, 200) + "…" : memo) : "");
    block.addEventListener("click", function () {
        openEventPopover(event, block, timeText);
    });
    return block;
}

// 내 계획 블록: 끌어서 옮기고, 아래쪽 끝을 끌어서 길이를 바꾸고, 그냥 누르면 작은 창이 열린다
function makePlanBlock(plan, item) {
    const block = document.createElement("div");
    block.className = "tl-block tl-plan" + (plan.taskDone ? " done" : "");
    block.dataset.key = "p:" + plan.id;

    const title = document.createElement("div");
    title.className = "tl-title";
    title.textContent = plan.title;
    block.appendChild(title);
    if (item.end - item.start >= 45) {
        const time = document.createElement("div");
        time.className = "tl-time";
        time.textContent = minToText(item.start) + "–" + minToText(item.end);
        block.appendChild(time);
    }
    const handle = document.createElement("div");
    handle.className = "tl-resize";
    block.appendChild(handle);

    block.title = minToText(plan.start) + "–" + minToText(plan.end) + "  " + plan.title + "\n끌어서 옮기고, 아래쪽 끝을 끌어서 길이를 바꿉니다";
    block.addEventListener("pointerdown", function (e) {
        beginPlanDrag(e, block, plan);
    });
    return block;
}

// ----- 끌기 도우미 -----

// 포인터 끌기 하나를 지켜본다. 4px 넘게 움직여야 끌기로 보고, 그 전에 손을 떼면 "그냥 누른 것"이다(moved가 false).
// 우선순위 탭, 프로젝트, 할 일 끌기와 같은 포인터 이벤트 방식이다. Esc를 누르면 취소한다.
// handlers: { move(event), end(event, moved), cancel() }
function trackTimelineDrag(startEvent, handlers) {
    if (startEvent.pointerType === "mouse" && startEvent.button !== 0) {
        return;
    }
    const drag = { startX: startEvent.clientX, startY: startEvent.clientY, moved: false };
    timelineDrag = drag;

    function onMove(e) {
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < PROJECT_DRAG_THRESHOLD) {
            return;
        }
        drag.moved = true;
        autoScrollTimeline(e.clientY);
        handlers.move(e);
    }
    function stop() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("keydown", onKey);
        timelineDrag = null;
    }
    function onUp(e) {
        stop();
        handlers.end(e, drag.moved);
    }
    function onCancel() {
        stop();
        handlers.cancel();
    }
    function onKey(e) {
        if (e.key === "Escape") {
            onCancel();
        }
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey);
}

// 끌다가 시간표의 위/아래 끝에 가까워지면 그쪽으로 스크롤한다 (끌 때 움직이는 동안만 일어난다)
function autoScrollTimeline(clientY) {
    const rect = timelineScroll.getBoundingClientRect();
    if (clientY < rect.top + 24) {
        timelineScroll.scrollTop -= 14;
    } else if (clientY > rect.bottom - 24) {
        timelineScroll.scrollTop += 14;
    }
}

// ----- 계획 만들기 / 옮기기 / 길이 바꾸기 / 지우기 -----

async function createPlan(start, end, title, taskId) {
    const body = { date: viewedDate, start: start, end: end };
    if (taskId) {
        body.taskId = taskId;
    } else {
        body.title = title;
    }
    await sendRequest("/api/time-blocks", "POST", body);
}

// 빈 곳을 끌어서(또는 눌러서) 새 계획을 만든다: 끈 만큼, 누르기만 하면 1시간짜리 블록에 제목 입력 칸이 열린다
timelineGrid.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".tl-block")) {
        return;  // 블록 위에서 시작한 끌기는 그 블록의 몫이다
    }
    closeTimelinePopover();
    const anchor = yToMin(e.clientY);
    let range = null;
    const ghost = document.createElement("div");
    ghost.className = "tl-block tl-plan tl-creating";

    trackTimelineDrag(e, {
        move: function (ev) {
            const current = yToMin(ev.clientY);
            let low = Math.max(0, floorSnap(Math.min(anchor, current)));
            let high = Math.min(TL_DAY_MIN, ceilSnap(Math.max(anchor, current)));
            if (high - low < snapStep()) {  // 최소 길이는 맞추는 단위(5분 또는 15분)와 같다
                high = Math.min(TL_DAY_MIN, low + snapStep());
                low = high - snapStep();
            }
            range = { start: low, end: high };
            placeBlock(ghost, range);
            if (!ghost.isConnected) {
                timelineGrid.appendChild(ghost);
            }
        },
        end: function (ev, moved) {
            if (!moved) {
                const start = clampNumber(floorSnap(anchor), 0, TL_DAY_MIN - TL_DEFAULT_LENGTH);
                range = { start: start, end: start + TL_DEFAULT_LENGTH };
            }
            openPlanCreator(ghost, range.start, range.end);
        },
        cancel: function () {
            ghost.remove();
        },
    });
});

// 새 계획 블록 안에 제목 입력 칸을 연다. Enter나 다른 곳을 누르면 저장하고, Esc나 빈 칸이면 취소한다
function openPlanCreator(block, start, end) {
    placeBlock(block, { start: start, end: end });
    block.replaceChildren();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tl-title-input";
    input.maxLength = 200;
    input.placeholder = "계획 (예: 토익 공부)";
    block.appendChild(input);
    if (!block.isConnected) {
        timelineGrid.appendChild(block);
    }
    input.focus();

    let finished = false;
    async function finish(save) {
        if (finished) {
            return;  // Enter로 끝낸 뒤 입력 칸이 사라지면서 생기는 blur는 무시한다
        }
        finished = true;
        const text = input.value.trim();
        block.remove();
        if (!save || !text) {
            return;
        }
        try {
            await createPlan(start, end, text, null);
        } catch (error) {
            showToast("계획을 만들지 못했습니다: " + error.message);
        }
        await reloadPlans();
    }
    input.addEventListener("keydown", function (e) {
        if (e.isComposing) {
            return;  // 한글을 조합하는 중의 Enter는 글자를 확정하는 키다
        }
        if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
        }
    });
    input.addEventListener("blur", function () {
        finish(true);
    });
}

// 계획 블록을 끌어서 옮기거나(몸통) 길이를 바꾼다(아래쪽 끝). 4px도 안 움직이고 놓으면 그냥 누른 것이라 작은 창이 열린다
function beginPlanDrag(e, block, plan) {
    if (e.target.closest("input, button, textarea")) {
        return;
    }
    const resizing = e.target.closest(".tl-resize") !== null;
    const length = plan.end - plan.start;
    const pressedAt = yToMin(e.clientY);  // 누른 순간 포인터가 가리킨 시각. 여기서 얼마나 움직였는지(delta)로 새 위치를 정한다
    let next = { start: plan.start, end: plan.end };

    trackTimelineDrag(e, {
        move: function (ev) {
            const delta = roundSnap(yToMin(ev.clientY) - pressedAt);
            if (resizing) {
                next = { start: plan.start, end: clampNumber(plan.end + delta, plan.start + snapStep(), TL_DAY_MIN) };
            } else {
                const start = clampNumber(plan.start + delta, 0, TL_DAY_MIN - length);
                next = { start: start, end: start + length };
            }
            block.classList.add("dragging");
            block.style.top = minToY(next.start) + "px";
            const dragHeight = Math.max(minToY(next.end - next.start), TL_MIN_VISIBLE_PX);
            block.style.height = dragHeight + "px";
            fitBlockText(block, dragHeight);  // 길이를 바꾸는 동안 글자 크기도 따라간다
            const time = block.querySelector(".tl-time");
            if (time) {
                time.textContent = minToText(next.start) + "–" + minToText(next.end);
            }
        },
        end: async function (ev, moved) {
            block.classList.remove("dragging");
            if (!moved) {
                openPlanPopover(plan, block);
                return;
            }
            if (next.start !== plan.start || next.end !== plan.end) {
                try {
                    await sendRequest("/api/time-blocks/" + plan.id, "PATCH", { start: next.start, end: next.end });
                } catch (error) {
                    showToast("계획을 옮기지 못했습니다: " + error.message);
                }
            }
            await reloadPlans();  // 서버에 있는 실제 모습으로 다시 그린다 (실패했으면 제자리로 돌아온다)
        },
        cancel: function () {
            block.classList.remove("dragging");
            renderTimeline();
        },
    });
}

// ----- 블록을 눌렀을 때 뜨는 작은 창 -----

function closeTimelinePopover() {
    if (!timelinePopover) {
        return;
    }
    const popover = timelinePopover;
    timelinePopover = null;
    if (popover.onClose) {
        popover.onClose();  // 쓰던 메모가 있으면 저장한다
    }
    popover.el.remove();
    document.querySelectorAll(".tl-block.selected").forEach(function (block) {
        block.classList.remove("selected");
    });
}

// 작은 창을 블록 옆(오른쪽, 자리가 없으면 왼쪽)에 놓는다. 화면 밖으로 나가지 않게 맞춘다
function positionPopover(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    let left = rect.right + 10;
    if (left + width > window.innerWidth - 8) {
        left = rect.left - width - 10;
    }
    left = clampNumber(left, 8, Math.max(8, window.innerWidth - width - 8));
    const top = clampNumber(rect.top, 8, Math.max(8, window.innerHeight - popover.offsetHeight - 8));
    popover.style.left = left + "px";
    popover.style.top = top + "px";
}

// 작은 창을 열고 화면에 붙인다. 같은 블록의 창이 이미 열려 있으면 닫는다(다시 누르면 닫힘)
function showTimelinePopover(key, anchor, build) {
    if (timelinePopover && timelinePopover.key === key) {
        closeTimelinePopover();
        return;
    }
    closeTimelinePopover();
    const el = document.createElement("div");
    el.className = "tl-popover";
    timelinePopover = { el: el, key: key, onClose: null, anchor: anchor };
    anchor.classList.add("selected");
    document.body.appendChild(el);
    build(el, timelinePopover);
    positionPopover(el, anchor);
}

// 작은 창 밖을 누르면 닫는다 (다른 블록을 누르면 그 블록의 클릭이 새 창을 연다)
document.addEventListener("pointerdown", function (e) {
    if (timelinePopover && !timelinePopover.el.contains(e.target) && !e.target.closest(".tl-block")) {
        closeTimelinePopover();
    }
}, true);
timelineScroll.addEventListener("scroll", closeTimelinePopover);
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && timelinePopover && !e.target.closest(".tl-popover")) {
        closeTimelinePopover();
    }
});

function makePopoverButton(text, onClick, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (className) {
        button.className = className;
    }
    button.addEventListener("click", onClick);
    return button;
}

// Google 일정의 작은 창: 제목과 시간, 메모 칸, [일정 수정…] [닫기]
function openEventPopover(event, block, timeText) {
    showTimelinePopover("e:" + event.id, block, function (el, popover) {
        const title = document.createElement("h3");
        title.textContent = event.title;
        const sub = document.createElement("p");
        sub.className = "tl-pop-sub";
        sub.textContent = timeText;
        el.append(title, sub);

        const canEdit = Boolean(event.canEdit);
        // text: 입력 칸의 글, saved: Google에 저장된 것으로 아는 글. 둘이 다르면 아직 저장 전(또는 저장 실패)이다
        const memo = { text: memoText(event.description), saved: memoText(event.description), saving: false, again: false, failed: false };

        // 메모를 Google에 저장한다. 저장하는 사이에 또 고쳤으면 끝난 뒤 한 번 더 저장한다
        async function saveMemo() {
            if (memo.saving) {
                memo.again = true;
                return;
            }
            if (memo.text === memo.saved) {
                return;
            }
            memo.saving = true;
            memo.failed = false;
            pendingEventMemoSaves++;
            const text = memo.text;
            try {
                await sendRequest("/api/events/" + encodeURIComponent(event.id), "PATCH", {
                    calendarId: event.calendarId,
                    description: text,
                });
                memo.saved = text;
                event.description = text;  // 이 블록을 만든 데이터도 맞춰 둔다
                calendar.refetchEvents();  // 캘린더 탭의 툴팁도 새 메모를 보여주도록
            } catch (error) {
                memo.failed = true;
                showToast("메모를 저장하지 못했습니다: " + error.message);
            } finally {
                memo.saving = false;
                pendingEventMemoSaves--;
                if (!memo.failed) {
                    renderTimeline();  // 블록에 새 메모를 보여준다
                }
                if (memo.again) {
                    memo.again = false;
                    if (!memo.failed) {
                        saveMemo();
                    }
                }
            }
        }

        if (canEdit) {
            const label = document.createElement("label");
            label.className = "tl-pop-label";
            label.textContent = "메모";
            const input = document.createElement("textarea");
            input.rows = 1;
            input.maxLength = EVENT_MEMO_MAX;
            input.placeholder = "예: 노트 가져가기";
            input.value = memo.text;
            label.htmlFor = "tl-pop-memo";
            input.id = "tl-pop-memo";
            const tip = document.createElement("p");
            tip.className = "tl-pop-tip";
            tip.textContent = "Enter 저장 · Shift+Enter 줄바꿈";
            el.append(label, input, tip);

            // 글이 늘어나는 만큼 입력 칸도 높아진다 (+2는 위아래 테두리). 창 높이가 변하니 위치도 다시 맞춘다
            function fitHeight() {
                input.style.height = "auto";
                input.style.height = (input.scrollHeight + 2) + "px";
                positionPopover(el, popover.anchor);
            }
            fitHeight();
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);  // 커서를 글 맨 끝에

            let timer = null;
            input.addEventListener("input", function () {
                fitHeight();
                clearTimeout(timer);
                timer = setTimeout(function () {
                    memo.text = input.value.trim();
                    saveMemo();
                }, EVENT_MEMO_SAVE_DELAY_MS);
            });
            // 다른 곳을 누르면 바로 저장한다 (창은 그대로 둔다. [일정 수정…]을 누르려다 입력 칸을 벗어날 수도 있으니까)
            input.addEventListener("blur", function () {
                clearTimeout(timer);
                memo.text = input.value.trim();
                saveMemo();
            });
            // Enter: 저장하고 창을 닫는다. 줄바꿈은 Shift+Enter. 한글을 조합하는 중의 Enter는 마지막 글자를 확정하는 키라서 건드리지 않는다
            input.addEventListener("keydown", function (e) {
                if (e.isComposing) {
                    return;
                }
                if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    closeTimelinePopover();
                }
            });
            popover.onClose = function () {
                clearTimeout(timer);
                memo.text = input.value.trim();
                saveMemo();
            };
        } else if (memo.text) {
            const readonly = document.createElement("p");
            readonly.className = "tl-pop-readonly";
            readonly.textContent = memo.text;
            el.appendChild(readonly);
        }

        const buttons = document.createElement("div");
        buttons.className = "tl-pop-buttons";
        if (canEdit) {
            buttons.appendChild(makePopoverButton("일정 수정…", function () {
                closeTimelinePopover();
                openEditDialog({ event: eventAsCalendarEvent(event) });
            }));
        }
        buttons.appendChild(makePopoverButton("닫기", closeTimelinePopover));
        el.appendChild(buttons);
    });
}

// 내 계획의 작은 창: 제목(할 일과 연결된 계획은 할 일 이름), 시간과 길이, [삭제] [닫기]
function openPlanPopover(plan, block) {
    showTimelinePopover("p:" + plan.id, block, function (el, popover) {
        const linked = plan.taskId !== null;
        let titleInput = null;
        if (linked) {
            const title = document.createElement("h3");
            title.textContent = plan.title;
            el.appendChild(title);
        } else {
            titleInput = document.createElement("input");
            titleInput.type = "text";
            titleInput.className = "tl-title-input";
            titleInput.maxLength = 200;
            titleInput.value = plan.title;
            titleInput.setAttribute("aria-label", "계획 제목");
            el.appendChild(titleInput);
        }
        const sub = document.createElement("p");
        sub.className = "tl-pop-sub";
        sub.style.marginTop = "6px";
        sub.textContent = minToText(plan.start) + "–" + minToText(plan.end) + " (" + durationText(plan.end - plan.start) + ")" + (linked ? " · 할 일과 연결됨" : "");
        el.appendChild(sub);

        if (linked) {
            // 연결된 할 일의 완료를 시간표에서 바로 체크한다
            const row = document.createElement("label");
            row.className = "tl-pop-check";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = plan.taskDone;
            checkbox.addEventListener("change", function () {
                updateTask(plan.taskId, { done: checkbox.checked }, reloadTodayAndTimeline);
            });
            row.append(checkbox, "할 일 완료");
            el.appendChild(row);
        }

        // 제목 고치기: Enter나 창을 벗어날 때 바뀌었으면 저장한다. Esc는 되돌리고 닫는다
        if (titleInput) {
            popover.onClose = async function () {
                const text = titleInput.value.trim();
                if (!text || text === plan.title) {
                    return;
                }
                try {
                    await sendRequest("/api/time-blocks/" + plan.id, "PATCH", { title: text });
                } catch (error) {
                    showToast("제목을 고치지 못했습니다: " + error.message);
                }
                await reloadPlans();
            };
            titleInput.addEventListener("keydown", function (e) {
                if (e.isComposing) {
                    return;
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    closeTimelinePopover();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    titleInput.value = plan.title;
                    closeTimelinePopover();
                }
            });
            titleInput.focus();
            titleInput.select();
        }

        // 삭제 버튼: 일정이나 할 일 삭제와 같이 두 번 눌러야 지워진다. 한 번 누르고 3초 동안 안 누르면 원래대로 돌아간다
        const buttons = document.createElement("div");
        buttons.className = "tl-pop-buttons";
        let armed = false;
        let armTimer = null;
        const deleteButton = makePopoverButton("삭제", async function () {
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
            popover.onClose = null;  // 지우는 블록의 제목을 저장하려 하지 않게
            closeTimelinePopover();
            try {
                await sendRequest("/api/time-blocks/" + plan.id, "DELETE");
            } catch (error) {
                showToast("계획을 지우지 못했습니다: " + error.message);
            }
            await reloadPlans();
        }, "danger");
        const spacer = document.createElement("span");
        spacer.className = "spacer";
        buttons.append(deleteButton, spacer, makePopoverButton("닫기", closeTimelinePopover));
        el.appendChild(buttons);
    });
}

// ----- 할 일을 시간표로 끌어다 놓기 -----
// 할 일 끌기(beginTaskDrag)가 시간표 위에서 끝나면 부른다. 보고 있는 날짜의 할 일이 아니면(할 일 목록, 밀린 할 일) 먼저 그 날짜로 정한다.
// 끄는 동안에는 놓일 자리를 점선 상자로 미리 보여 준다.

let timelineDropPreview = null;

function showTimelineDropPreview(start, text) {
    if (!timelineDropPreview) {
        timelineDropPreview = document.createElement("div");
        timelineDropPreview.className = "tl-drop-preview";
        timelineGrid.appendChild(timelineDropPreview);
    }
    timelineDropPreview.style.top = minToY(start) + "px";
    timelineDropPreview.style.height = minToY(TL_DEFAULT_LENGTH) + "px";
    timelineDropPreview.textContent = minToText(start) + "  " + text;
}

function hideTimelineDropPreview() {
    if (timelineDropPreview) {
        timelineDropPreview.remove();
        timelineDropPreview = null;
    }
}

// 포인터 위치에 놓을 때의 시작 시각 (15분 단위, 1시간짜리 블록이 하루 안에 들어오도록 맞춘다)
function dropStartMinutes(clientY) {
    return clampNumber(floorSnap(yToMin(clientY)), 0, TL_DAY_MIN - TL_DEFAULT_LENGTH);
}

async function dropTaskOnTimeline(task, start) {
    try {
        if (task.date !== viewedDate) {
            await sendRequest("/api/tasks/" + task.id, "PATCH", { date: viewedDate });
        }
        await createPlan(start, start + TL_DEFAULT_LENGTH, null, task.id);
        showToast("'" + task.content + "'을(를) " + minToText(start) + "–" + minToText(start + TL_DEFAULT_LENGTH) + "에 배치했습니다");
    } catch (error) {
        showToast("시간표에 놓지 못했습니다: " + error.message);
    }
    await reloadTodayAndInbox();
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
//   toInbox: 오늘 탭에서 쓴다. 프로젝트 없는 할 일에 "목록으로"(날짜를 빼서 할 일 목록으로 돌려보내기) 버튼을 둔다
//   dragFrom: "inbox"(할 일 목록의 줄)나 "loose"(오늘 탭의 프로젝트 없는 할 일 줄)이면 그 줄을 끌어서 옮길 수 있다
function makeTaskRow(task, options) {
    const item = document.createElement("li");
    item.className = "task-row";
    item.dataset.taskId = task.id;  // 시간표에 배치한 할 일 옆에 시간을 붙일 때(refreshTaskSlots) 이 줄을 찾는 이름표
    item.dataset.done = task.done === 1 ? "1" : "0";  // 끌어서 순서를 바꿀 때 끝내지 않은 줄만 골라내는 이름표(taskInsertIndex)
    if (options.dragFrom) {
        item.classList.add("task-draggable");
        item.addEventListener("pointerdown", function (e) {
            beginTaskDrag(e, item, task, options.dragFrom);
        });
    }

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

    // 오늘 탭 목록에서만: 끝내지 않은 할 일에 "1, 2, 3…" 번호를 붙인다. 끌어서 순서를 바꾸면 번호가 따라 바뀐다.
    // 1번이 "첫 번째로 할 것"이라 파랗게 강조한다. 하나뿐이면 번호가 필요 없어서 loadTodayTasks가 rank를 주지 않는다
    if (options.rank) {
        const rank = document.createElement("span");
        rank.className = "task-rank" + (options.rank === 1 ? " first" : "");
        rank.textContent = options.rank;
        rank.title = options.rank + "번째로 할 일 (줄을 끌어서 순서를 바꿉니다)";
        item.classList.add("has-rank");  // 메모를 체크박스 글자 줄에 맞추려고 (style.css의 .task-memo-box)
        item.appendChild(rank);
    }
    item.append(checkbox, content);

    // 이름 고치기: 이름을 두 번 클릭하거나 줄의 "수정" 버튼을 누르면 이름 자리가 입력 칸으로 바뀐다.
    // Enter나 다른 곳을 누르면 저장하고, Esc는 취소한다. 비우면 저장하지 않고 원래대로 둔다(지우기는 "삭제" 버튼으로 한다)
    function startEditing() {
        if (item.classList.contains("editing")) {
            return;
        }
        item.classList.add("editing");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "task-edit-input";
        input.value = task.content;
        let finished = false;

        async function finish(save) {
            if (finished) {
                return;  // Enter로 끝낸 뒤 입력 칸이 사라지면서 생기는 blur는 무시한다
            }
            finished = true;
            const text = input.value.trim();
            if (!save || !text || text === task.content) {
                input.replaceWith(content);
                item.classList.remove("editing");
                return;
            }
            try {
                await sendRequest("/api/tasks/" + task.id, "PATCH", { content: text });
                task.content = text;
                await options.reload();  // 목록을 다시 그리면 새 이름으로 나온다
            } catch (error) {
                showToast("이름을 고치지 못했습니다: " + error.message);
                input.replaceWith(content);
                item.classList.remove("editing");
            }
        }

        input.addEventListener("keydown", function (e) {
            if (e.isComposing) {
                return;  // 한글을 조합하는 중의 Enter는 글자를 확정하는 키다 (오늘 탭 입력칸과 같은 이유)
            }
            if (e.key === "Enter") {
                e.preventDefault();
                finish(true);
            } else if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
            }
        });
        input.addEventListener("blur", function () {
            finish(true);
        });
        content.replaceWith(input);
        input.focus();
        input.select();
    }
    content.addEventListener("dblclick", startEditing);
    content.title = "두 번 클릭해서 이름 고치기";

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

    // 메모: 줄 아래 칸에 작은 회색 글씨로 보인다 (모양은 style.css의 .task-memo-box. 메모가 있을 때만 줄이 두 줄이 된다).
    // 메모가 없을 때는 마우스를 올리면 뜨는 "메모" 버튼으로 쓰기 시작한다 (메모가 생기면 버튼은 CSS로 숨겨진다)
    const memoBox = makeInlineMemo({
        text: task.memo,
        placeholder: "예: 준비물, 참고 링크",
        maxLength: TASK_MEMO_MAX,
        boxClass: "task-memo-box",
        viewClass: "task-memo",
        inputClass: "task-memo-input",
        save: async function (text) {
            await sendRequest("/api/tasks/" + task.id, "PATCH", { memo: text });
            task.memo = text;
        },
    });
    item.appendChild(memoBox);
    const memoButton = document.createElement("button");
    memoButton.className = "task-memo-button";
    memoButton.textContent = "메모";
    memoButton.title = "이 할 일에 메모 붙이기";
    memoButton.addEventListener("click", memoBox.startEditing);
    actions.appendChild(memoButton);

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

    // 오늘 탭의 프로젝트 없는 할 일: 날짜를 빼서 "할 일 목록"으로 돌려보낸다(나중으로 미루기). 끝낸 것과 날짜 없는 것은 해당 없다
    if (options.toInbox && !task.project_id && task.done !== 1 && task.date) {
        const inboxButton = document.createElement("button");
        inboxButton.textContent = "목록으로";
        inboxButton.title = "날짜를 빼고 '할 일 목록'으로 돌려보냅니다";
        inboxButton.addEventListener("click", function () {
            updateTask(task.id, { date: null }, options.reload);
        });
        actions.appendChild(inboxButton);
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
    const date = viewedDate;  // loadTimeline과 같은 이유로, 요청 시점의 날짜를 기억해둔다
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
    // 끝내지 않은 할 일의 번호를 화면 순서대로 기억해 둔다 (끌어서 순서를 바꿀 때 새 순서를 만드는 데 쓴다).
    // 끝내지 않은 할 일이 둘 이상일 때만 1, 2, 3… 번호를 보여준다
    const openTasks = data.tasks.filter(function (task) {
        return task.done !== 1;
    });
    todayTaskOrder = openTasks.map(function (task) {
        return task.id;
    });
    let rankCounter = 0;
    data.tasks.forEach(function (task) {
        const isOpen = task.done !== 1;
        if (isOpen) {
            rankCounter++;
        }
        todayTasksList.appendChild(makeTaskRow(task, {
            rank: isOpen && openTasks.length >= 2 ? rankCounter : null,
            reload: reloadTodayAndInbox,
            moveLabel: isToday ? "내일로" : "다음 날로",
            moveDate: addDaysToText(date, 1),
            showDate: task.date !== date,
            showProject: true,
            unscheduleOnly: true,
            toInbox: true,
            // 끌 수 있는 할 일: 프로젝트 없는 할 일("loose")은 시간표나 "할 일 목록"으로, 프로젝트 할 일("project")은 시간표로(또는 작은 달력 날짜로)
            dragFrom: task.done === 1 ? null : (task.project_id ? "project" : "loose"),
        }));
    });

    loadMiniTaskDays();  // 할 일이 바뀌었을 수 있으니 작은 달력의 점도 새로 받는다

    // 밀린 할 일은 "오늘 기준"의 개념이라서 오늘을 볼 때만 보인다. 있을 때만 구역을 보이고, "오늘로" 버튼은 날짜를 오늘로 바꾼다
    overdueTasksList.innerHTML = "";
    overdueSection.hidden = !isToday || data.overdue.length === 0;
    if (isToday) {
        data.overdue.forEach(function (task) {
            overdueTasksList.appendChild(makeTaskRow(task, {
                reload: reloadTodayAndInbox,
                moveLabel: "오늘로",
                moveDate: todayText,
                showDate: true,
                showProject: true,
                unscheduleOnly: true,
                toInbox: true,
                dragFrom: task.project_id ? "project" : "loose",
            }));
        });
    }
    refreshTaskSlots();  // 시간표에 배치한 할 일 옆에 "16:30–18:30"을 붙인다
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

// ----- 작은 달력 -----
// 오늘 탭 왼쪽 위의 한 달짜리 달력. 날짜를 누르면 그날의 일정과 할 일로 넘어가서, ◀ ▶로 하루씩 넘기지 않고도 멀리 있는 날로 갈 수 있다.
// 지금 보고 있는 날은 파란 바탕, 오늘은 테두리 고리, 할 일이 있는 날은 작은 점(안 끝낸 것이 있으면 파랑, 모두 끝냈으면 회색)으로 보인다.
// 달을 넘기는 ‹ ›는 달력만 움직이고, 보고 있는 날은 바꾸지 않는다. ◀ ▶나 날짜 누르기로 날이 바뀌면 달력도 그 달로 따라간다.
// 할 일 목록의 할 일을 끌어다 날짜 칸에 놓으면 그 날짜로 정해진다. FullCalendar는 쓰지 않고 직접 만든다(한 달 격자 하나면 되고, 오늘 탭의 날짜 이동과 한 몸으로 움직여야 해서)

const miniCalendar = document.getElementById("mini-calendar");
const MINI_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];  // 큰 캘린더(한국어 설정)와 같이 일요일부터 시작한다
let miniMonth = null;      // 지금 달력이 보여주는 달 { year, month(0~11) }
let miniTaskDays = {};     // 날짜 → { open: 안 끝낸 개수, done: 끝낸 개수 }. 점을 찍으려고 서버에서 받아 둔다
let miniRequest = 0;       // 가장 최근 요청의 번호. 늦게 도착한 옛 응답이 새 달을 덮지 않게 한다 (캘린더 탭의 할 일 요약과 같은 이유)

// 보고 있는 날짜의 달로 달력을 맞춘다 (showDay가 부른다)
function syncMiniCalendar() {
    const [year, month] = viewedDate.split("-").map(Number);
    miniMonth = { year: year, month: month - 1 };
    renderMiniCalendar();
}

// 달력 상자를 다시 그린다: 머리줄(‹ 2026년 10월 ›), 요일 줄, 6주 × 7일 격자
function renderMiniCalendar() {
    if (!miniMonth) {
        return;
    }
    miniCalendar.innerHTML = "";

    const head = document.createElement("div");
    head.className = "mini-head";
    const prev = document.createElement("button");
    prev.className = "mini-nav";
    prev.textContent = "‹";
    prev.title = "이전 달";
    prev.addEventListener("click", function () {
        moveMiniMonth(-1);
    });
    const next = document.createElement("button");
    next.className = "mini-nav";
    next.textContent = "›";
    next.title = "다음 달";
    next.addEventListener("click", function () {
        moveMiniMonth(1);
    });
    const title = document.createElement("span");
    title.className = "mini-title";
    title.textContent = miniMonth.year + "년 " + (miniMonth.month + 1) + "월";
    head.append(prev, title, next);

    const grid = document.createElement("div");
    grid.className = "mini-grid";
    MINI_WEEKDAYS.forEach(function (name) {
        const label = document.createElement("span");
        label.className = "mini-weekday";
        label.textContent = name;
        grid.appendChild(label);
    });

    // 그 달 1일이 들어 있는 주의 일요일부터 6주(42일)를 그린다. 앞뒤 달의 날짜는 흐리게 보인다
    const first = new Date(miniMonth.year, miniMonth.month, 1);
    const start = addDays(first, -first.getDay());
    for (let i = 0; i < 42; i++) {
        const date = addDays(start, i);
        const dateText = toDateText(date);
        const button = document.createElement("button");
        button.className = "mini-day";
        button.dataset.date = dateText;
        button.textContent = date.getDate();
        button.title = (date.getMonth() + 1) + "월 " + date.getDate() + "일";
        if (date.getMonth() !== miniMonth.month) {
            button.classList.add("other-month");
        }
        if (dateText === todayText) {
            button.classList.add("today");
        }
        if (dateText === viewedDate) {
            button.classList.add("selected");
        }
        button.addEventListener("click", function () {
            if (dateText !== viewedDate) {
                showDay(dateText);
            }
        });
        grid.appendChild(button);
    }
    miniCalendar.append(head, grid);
    paintMiniDots();
    loadMiniTaskDays();
}

// 달만 넘긴다(보고 있는 날은 그대로). 보고 있는 날이 다른 달에 있으면 달력에 파란 칸이 안 보일 뿐이다
function moveMiniMonth(delta) {
    const next = new Date(miniMonth.year, miniMonth.month + delta, 1);
    miniMonth = { year: next.getFullYear(), month: next.getMonth() };
    renderMiniCalendar();
}

// 보이는 42일의 할 일 개수를 서버에서 받아 점을 찍는다. 내 컴퓨터 DB만 읽으므로 빠르다. 할 일을 바꿀 때마다(loadTodayTasks) 다시 불러온다
async function loadMiniTaskDays() {
    const cells = miniCalendar.querySelectorAll(".mini-day");
    if (cells.length === 0) {
        return;
    }
    const start = cells[0].dataset.date;
    const end = addDaysToText(cells[cells.length - 1].dataset.date, 1);  // end는 포함하지 않는 날짜
    const request = ++miniRequest;
    try {
        const response = await fetch("/api/task-days?start=" + start + "&end=" + end);
        if (!response.ok) {
            return;
        }
        const days = await response.json();
        if (request !== miniRequest) {
            return;  // 그 사이 달이 또 바뀌었다면 이 응답은 버린다
        }
        miniTaskDays = {};
        Object.keys(days).forEach(function (dateText) {
            const tasks = days[dateText];
            const done = tasks.filter(function (task) {
                return task.done === 1;
            }).length;
            miniTaskDays[dateText] = { open: tasks.length - done, done: done };
        });
        paintMiniDots();
    } catch (error) {
        // 점은 덤이라서 실패해도 달력은 그대로 쓸 수 있다
    }
}

// 받아 둔 개수대로 날짜 칸에 점을 붙였다 뗀다
function paintMiniDots() {
    miniCalendar.querySelectorAll(".mini-day").forEach(function (button) {
        const old = button.querySelector(".mini-dot");
        if (old) {
            old.remove();
        }
        const info = miniTaskDays[button.dataset.date];
        if (info) {
            const dot = document.createElement("span");
            dot.className = "mini-dot" + (info.open === 0 ? " done" : "");
            button.appendChild(dot);
            button.title = button.title.split(" · ")[0] + " · 할 일 " + (info.open + info.done) + "개" + (info.open > 0 ? " (" + info.open + " 남음)" : " (완료)");
        }
    });
}

// ----- 할 일 목록(수집함) -----
// 날짜를 아직 정하지 않은 할 일(프로젝트 없는 것만)을 모아 두는 오른쪽 패널. 먼저 줄줄이 적어 두고, 나중에 날짜를 정해 준다.
// 날짜를 정하는 방법은 둘이다: (1) 줄에 마우스를 올리면 나오는 [오늘] [내일] [날짜…] 버튼, (2) 줄을 가운데 "할 일" 칸으로 끌어다 놓기(보고 있는 날짜로 정해진다).
// 반대로 오늘 탭의 프로젝트 없는 할 일을 이 칸으로 끌어다 놓거나 "목록으로" 버튼을 누르면 날짜가 빠져서 다시 이 목록으로 돌아온다

// 오늘 탭의 할 일과 할 일 목록을 함께 다시 불러온다 (할 일이 이쪽 목록과 저쪽 목록 사이를 오가기 때문에 둘 다 맞춰야 한다)
// 시간표의 계획 블록도 함께 맞춘다: 할 일을 지우면 그 블록도 지워지고, 끝내면 블록도 끝낸 모양이 되기 때문이다
async function reloadTodayAndInbox() {
    await Promise.all([loadTodayTasks(), loadInbox(), reloadPlans()]);
}

async function loadInbox() {
    const response = await fetch("/api/inbox");
    if (!response.ok) {
        throw new Error("서버 오류: " + response.status);
    }
    const tasks = await response.json();
    inboxList.innerHTML = "";
    inboxCount.textContent = tasks.length > 0 ? "(" + tasks.length + ")" : "";
    if (tasks.length === 0) {
        showEmptyMessage(inboxList, "날짜를 정하지 않은 할 일이 없습니다.");
    }
    tasks.forEach(function (task) {
        inboxList.appendChild(makeTaskRow(task, {
            reload: reloadTodayAndInbox,
            dragFrom: "inbox",
            extraButtons: [
                makeAssignButton("오늘", function () { return todayText; }, task),
                makeAssignButton("내일", function () { return addDaysToText(todayText, 1); }, task),
                makeDatePickButton(task),
            ],
        }));
    });
}

// 할 일의 날짜를 정하고(PATCH) 두 목록을 다시 불러온다. 몇 월 며칠로 갔는지 알려 줘서, 가운데 목록에 안 보이는 날짜여도 잘 갔다는 것을 안다
async function assignTaskDate(task, dateText) {
    try {
        await sendRequest("/api/tasks/" + task.id, "PATCH", { date: dateText });
        const label = dateText === todayText ? "오늘" : dateText.slice(5).replace("-", "/");
        showToast("'" + task.content + "'을(를) " + label + " 할 일로 정했습니다");
    } catch (error) {
        showToast("날짜를 정하지 못했습니다: " + error.message);
    }
    await reloadTodayAndInbox();
}

// [오늘] [내일] 같은 버튼. getDate는 누른 순간의 날짜를 돌려주는 함수다 (자정을 넘겨 켜 둬도 맞도록 미리 계산해 두지 않는다)
function makeAssignButton(label, getDate, task) {
    const button = document.createElement("button");
    button.textContent = label;
    button.title = "이 할 일을 " + label + "로 정하기";
    button.addEventListener("click", function () {
        assignTaskDate(task, getDate());
    });
    return button;
}

// [날짜…] 버튼: 누르면 날짜 고르는 창이 열리고, 고르면 그 날짜로 정한다. 마감일 버튼과 같은 방식(투명한 <input type="date">를 겹쳐 두고 showPicker()로 연다)
function makeDatePickButton(task) {
    const wrapper = document.createElement("span");
    wrapper.className = "date-pick";
    const input = document.createElement("input");
    input.type = "date";
    input.tabIndex = -1;
    const button = document.createElement("button");
    button.textContent = "날짜…";
    button.title = "날짜를 골라서 정하기";
    button.addEventListener("click", function () {
        try {
            input.showPicker();
        } catch (error) {
            input.style.pointerEvents = "auto";  // showPicker를 쓸 수 없는 환경이면 날짜 칸을 그대로 눌러서 고른다
            input.style.opacity = "1";
            input.focus();
        }
    });
    input.addEventListener("change", function () {
        if (input.value) {
            assignTaskDate(task, input.value);
        }
    });
    wrapper.append(input, button);
    return wrapper;
}

// 입력 칸의 글자를 날짜 없는 할 일로 추가한다. 연달아 적을 수 있게 추가한 뒤에도 입력 칸에 커서를 둔다
async function addInboxTask() {
    const content = inboxInput.value.trim();
    if (!content) {
        return;
    }
    try {
        await sendRequest("/api/tasks", "POST", { content: content, date: null, projectId: null });
        inboxInput.value = "";
        await loadInbox();
    } catch (error) {
        showToast("할 일을 추가하지 못했습니다: " + error.message);
    }
    inboxInput.focus();
}

inboxAddButton.addEventListener("click", addInboxTask);
inboxInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.isComposing) {  // 한글 조합 중의 Enter는 글자를 확정하는 키라서 무시한다 (오늘 탭 입력칸과 같은 이유)
        addInboxTask();
    }
});

// ----- 할 일 끌어다 놓기 -----
// 프로젝트 끌기, 우선순위 탭과 같은 포인터 이벤트 방식이다. 다만 줄이 다시 그려져도(다른 곳에서 목록을 새로 불러와도) 끌기가 끊기지 않게
// 이벤트를 줄이 아니라 document에 건다. 줄 안의 체크박스, 버튼, 입력칸을 누른 것은 끌기가 아니고, 4px 넘게 움직여야 끌기로 본다.
//   할 일 목록 → 가운데 "할 일" 칸: 보고 있는 날짜로 정한다
//   오늘 탭의 프로젝트 없는 할 일 → 오른쪽 "할 일 목록" 칸: 날짜를 뺀다

let taskDrag = null;  // 끄는 중에만 값이 있다: { task, item, from, startX, startY, ghost, hover, insertIndex, dropMin, stepList }

// ----- 오늘 할 일 순서 바꾸기 -----
// 오늘 탭의 "오늘 할 일" 목록에서 줄을 끌어다 같은 목록의 다른 자리에 놓으면 그 자리로 순서가 바뀌고(서버에 날짜별로 저장된다),
// 끝내지 않은 할 일 앞에 1, 2, 3… 번호가 붙는다. "밀린 할 일"이나 "할 일 목록"의 줄을 이 목록에 놓으면 오늘 할 일이 되면서 그 자리에 들어간다.
// 끄는 동안에는 놓일 자리에 파란 줄이 보인다. 끝낸 할 일은 항상 맨 아래에 있고 끌 수 없다.
let todayTaskOrder = [];  // 끝내지 않은 오늘 할 일의 번호들, 지금 화면의 순서대로 (loadTodayTasks가 채운다)

// "오늘 할 일" 목록이 들어 있는 스크롤 상자 (밀린 할 일과 오늘 할 일이 함께 들어 있다). 여기에 놓으면 순서가 정해진다
function tasksListArea() {
    return document.querySelector("#tasks-column .column-scroll");
}

// 포인터(clientY)가 있는 자리가 끝내지 않은 오늘 할 일들 중 몇 번째 앞인지 구한다. 끌고 있는 줄은 뺀다.
// 줄들을 위에서부터 보면서, 줄의 가운데 선이 포인터보다 위에 있는 줄이 몇 개인지 센다 (그 개수가 곧 들어갈 자리)
function taskInsertIndex(clientY, draggedItem) {
    const rows = Array.from(todayTasksList.querySelectorAll(".task-row")).filter(function (row) {
        return row.dataset.done !== "1" && row !== draggedItem;
    });
    let index = 0;
    for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (clientY > rect.top + rect.height / 2) {
            index++;
        } else {
            break;
        }
    }
    return { index: index, rows: rows };
}

// 놓일 자리에 파란 줄을 보여 준다. 줄은 스크롤 상자 안에 절대 위치로 놓여서 목록의 배치를 밀지 않는다
function showTaskDropLine(index, rows) {
    const area = tasksListArea();
    let line = area.querySelector(".task-drop-line");
    if (!line) {
        line = document.createElement("div");
        line.className = "task-drop-line";
        area.appendChild(line);
    }
    let y;
    if (rows.length === 0) {
        y = todayTasksList.getBoundingClientRect().top;
    } else if (index < rows.length) {
        y = rows[index].getBoundingClientRect().top;
    } else {
        y = rows[rows.length - 1].getBoundingClientRect().bottom;
    }
    line.style.top = (y - area.getBoundingClientRect().top + area.scrollTop) + "px";
}

function hideTaskDropLine() {
    const line = tasksListArea().querySelector(".task-drop-line");
    if (line) {
        line.remove();
    }
}

// 줄을 오늘 할 일 목록의 index번째 자리에 놓는다. 이미 목록에 있던 줄이면 순서만 바꾸고,
// 밀린 할 일이나 할 일 목록에서 온 줄이면 먼저 날짜를 보고 있는 날짜로 정한 뒤 그 자리에 넣는다
async function dropTaskOnList(task, index, alreadyInList) {
    const ids = todayTaskOrder.filter(function (id) {
        return id !== task.id;
    });
    ids.splice(Math.min(index, ids.length), 0, task.id);
    try {
        if (!alreadyInList && task.date !== viewedDate) {
            await sendRequest("/api/tasks/" + task.id, "PATCH", { date: viewedDate });  // 날짜가 바뀌면 서버가 이전 순서를 비운다
        }
        await sendRequest("/api/tasks/order", "PUT", { date: viewedDate, ids: ids });
        if (!alreadyInList) {
            showToast("'" + task.content + "'을(를) " + (viewedDate === todayText ? "오늘" : viewedDate.slice(5).replace("-", "/")) + " 할 일 " + (ids.indexOf(task.id) + 1) + "번째로 정했습니다");
        }
    } catch (error) {
        showToast("순서를 바꾸지 못했습니다: " + error.message);
    }
    await reloadTodayAndInbox();  // 서버에 있는 실제 순서로 화면을 맞춘다 (실패했으면 제자리로 돌아온다)
}

// ----- 프로젝트 단계 순서 바꾸기 -----
// 프로젝트 카드 안의 단계(맨 위 단계, 하위 단계)를 끌어서 같은 묶음 안의 다른 자리에 놓으면 순서가 바뀌고 서버에 저장된다.
// 맨 위 단계는 맨 위 단계들끼리, 하위 단계는 같은 상위 단계 아래에서만 옮긴다. 끝낸 단계는 항상 맨 아래에 있고 끌 수 없다.
// 순서를 정한 적 없는 단계는 마감일이 빠른 순으로 보인다(서버가 정렬한다. app.py의 step_sort_key).
// 끌기 상태(taskDrag)와 이벤트는 오늘 할 일 끌기와 같은 것을 쓰고, from이 "step"일 때만 아래 함수들이 일한다.

// 같은 묶음의 끝내지 않은 줄들 (끌고 있는 줄은 빼고 싶으면 except를 준다)
function stepRows(list, except) {
    return Array.from(list.children).filter(function (row) {
        return row.classList.contains("task-row") && row.dataset.done !== "1" && row !== except;
    });
}

// 줄 하나가 차지하는 아래쪽 끝. 하위 단계가 있는 단계는 그 아래 하위 단계 묶음(sub-wrapper)까지 한 덩어리로 본다
function stepBlockBottom(row) {
    const next = row.nextElementSibling;
    return (next && next.classList.contains("sub-wrapper") ? next : row).getBoundingClientRect().bottom;
}

// 끄는 동안 호출된다: 포인터가 이 묶음 위에 있으면 놓일 자리에 파란 줄을 보여 주고, 화면 위/아래 끝에 가까우면 페이지를 스크롤한다
function moveStepDrag(e, drag) {
    const list = drag.item.parentElement;
    const listRect = list.getBoundingClientRect();
    const cardRect = list.closest(".project-card").getBoundingClientRect();
    // 줄 목록의 위아래로 조금 여유를 둔다 (맨 위로 옮기거나 맨 아래로 보낼 때 정확히 줄 위에 놓지 않아도 되게)
    const inside = e.clientX >= cardRect.left && e.clientX <= cardRect.right
        && e.clientY >= listRect.top - 24 && e.clientY <= listRect.bottom + 24;
    hideStepDropLine();
    drag.stepList = inside ? list : null;
    if (inside) {
        const rows = stepRows(list, drag.item);
        let index = 0;
        for (const row of rows) {
            const rect = row.getBoundingClientRect();
            if (e.clientY > rect.top + rect.height / 2) {
                index++;
            } else {
                break;
            }
        }
        drag.insertIndex = index;
        let y;
        if (rows.length === 0) {
            y = listRect.top;
        } else if (index < rows.length) {
            y = rows[index].getBoundingClientRect().top;
        } else {
            y = stepBlockBottom(rows[rows.length - 1]);
        }
        const line = document.createElement("div");
        line.className = "task-drop-line";
        line.style.top = (y - listRect.top) + "px";
        list.appendChild(line);
    }
    if (e.clientY < 40) {
        window.scrollBy(0, -14);
    } else if (e.clientY > window.innerHeight - 40) {
        window.scrollBy(0, 14);
    }
}

function hideStepDropLine() {
    document.querySelectorAll(".project-card .task-drop-line").forEach(function (line) {
        line.remove();
    });
}

// 단계를 목록의 index번째 자리에 놓는다. 순서가 그대로면 서버에 묻지 않는다
async function dropStepOnList(task, list, index) {
    const before = stepRows(list).map(function (row) {
        return Number(row.dataset.taskId);
    });
    const ids = before.filter(function (id) {
        return id !== task.id;
    });
    ids.splice(Math.min(index, ids.length), 0, task.id);
    if (ids.join(",") === before.join(",")) {
        return;
    }
    try {
        // parentId가 null이면 맨 위 단계들의 순서, 숫자면 그 단계의 하위 단계들의 순서
        await sendRequest("/api/projects/" + task.project_id + "/steps/order", "PUT", { parentId: task.parent_id, ids: ids });
    } catch (error) {
        showToast("순서를 바꾸지 못했습니다: " + error.message);
    }
    await loadProjects();  // 서버에 있는 실제 순서로 화면을 맞춘다 (실패했으면 제자리로 돌아온다)
}

function beginTaskDrag(e, item, task, from) {
    if (e.pointerType === "mouse" && e.button !== 0) {
        return;
    }
    if (item.classList.contains("editing") || e.target.closest("button, input, select, textarea, .task-memo-box, .deadline-control, .date-pick")) {
        return;
    }
    taskDrag = { task: task, item: item, from: from, startX: e.clientX, startY: e.clientY, ghost: null, hover: null };
    document.addEventListener("pointermove", moveTaskDrag);
    document.addEventListener("pointerup", endTaskDrag);
    document.addEventListener("pointercancel", cancelTaskDrag);
    document.addEventListener("keydown", cancelTaskDragOnEscape);
}

// 이 끌기에서 놓을 수 있는 칸. 어디서 끌었든(from) 시간표(계획이 된다)와 작은 달력의 날짜 칸(그 날짜로 정해진다)에는 놓을 수 있다.
//  - 할 일 목록("inbox")에서 온 것: 가운데 "할 일" 칸(보고 있는 날짜로 정해진다)
//  - 오늘 탭의 프로젝트 없는 할 일("loose"): 오른쪽 "할 일 목록" 칸(날짜가 빠진다)
//  - 오늘 탭의 프로젝트 할 일("project"): 날짜를 뺄 수 없으니(프로젝트 카드에서 다룬다) 위의 두 곳뿐이다
function taskDropTarget(x, y, from) {
    const element = document.elementFromPoint(x, y);
    if (!element) {
        return null;
    }
    const target = element.closest(".tl-grid") || element.closest(".mini-day");
    if (target) {
        return target;
    }
    // 오늘 할 일 목록 위: 어디서 끌었든 그 자리로 순서가 정해진다 (오늘 할 일이면 순서만 바뀌고, 다른 곳에서 온 줄은 오늘 할 일이 된다)
    const listArea = element.closest("#tasks-column .column-scroll");
    if (listArea) {
        return listArea;
    }
    if (from === "inbox") {
        return element.closest("#tasks-column");
    }
    return from === "loose" ? element.closest("#inbox-column") : null;
}

function moveTaskDrag(e) {
    const drag = taskDrag;
    if (!drag) {
        return;
    }
    if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < PROJECT_DRAG_THRESHOLD) {
            return;
        }
        drag.ghost = document.createElement("div");
        drag.ghost.className = "task-ghost";
        drag.ghost.textContent = drag.task.content;
        document.body.appendChild(drag.ghost);
        drag.item.classList.add("drag-source");
        document.body.classList.add("task-dragging");
    }
    drag.ghost.style.left = (e.clientX + 14) + "px";
    drag.ghost.style.top = (e.clientY + 14) + "px";

    if (drag.from === "step") {
        moveStepDrag(e, drag);  // 프로젝트 단계는 날짜가 아니라 순서만 바꾼다
        return;
    }

    const target = taskDropTarget(e.clientX, e.clientY, drag.from);
    if (target !== drag.hover) {
        if (drag.hover) {
            drag.hover.classList.remove("drop-hover");
        }
        if (target) {
            target.classList.add("drop-hover");
        }
        drag.hover = target;
    }

    // 시간표 위에서는 놓일 자리(15분 단위)를 점선 상자로 미리 보여 준다
    if (drag.hover && drag.hover.classList.contains("tl-grid")) {
        drag.dropMin = dropStartMinutes(e.clientY);
        showTimelineDropPreview(drag.dropMin, drag.task.content);
    } else {
        hideTimelineDropPreview();
    }

    // 오늘 할 일 목록 위에서는 놓일 자리에 파란 줄을 보여 주고, 목록의 위/아래 끝에 가까우면 그쪽으로 스크롤한다
    if (drag.hover && drag.hover === tasksListArea()) {
        const place = taskInsertIndex(e.clientY, drag.item);
        drag.insertIndex = place.index;
        showTaskDropLine(place.index, place.rows);
        const rect = drag.hover.getBoundingClientRect();
        if (e.clientY < rect.top + 28) {
            drag.hover.scrollTop -= 12;
        } else if (e.clientY > rect.bottom - 28) {
            drag.hover.scrollTop += 12;
        }
    } else {
        hideTaskDropLine();
    }
}

// 끌기를 마무리한다. drop이 true이고 놓을 수 있는 칸 위였다면 날짜를 바꾼다
function finishTaskDrag(drop) {
    const drag = taskDrag;
    if (!drag) {
        return;
    }
    taskDrag = null;
    document.removeEventListener("pointermove", moveTaskDrag);
    document.removeEventListener("pointerup", endTaskDrag);
    document.removeEventListener("pointercancel", cancelTaskDrag);
    document.removeEventListener("keydown", cancelTaskDragOnEscape);
    document.body.classList.remove("task-dragging");
    drag.item.classList.remove("drag-source");
    if (drag.ghost) {
        drag.ghost.remove();
    }
    if (drag.hover) {
        drag.hover.classList.remove("drop-hover");
    }
    hideTimelineDropPreview();
    hideTaskDropLine();
    hideStepDropLine();
    if (drag.from === "step") {
        if (drop && drag.ghost && drag.stepList) {
            dropStepOnList(drag.task, drag.stepList, drag.insertIndex || 0);
        }
        return;
    }
    if (!drop || !drag.hover || !drag.ghost) {
        return;
    }
    if (drag.hover.classList.contains("tl-grid")) {
        dropTaskOnTimeline(drag.task, drag.dropMin);  // 시간표에 놓으면 그 시간의 계획이 된다
        return;
    }
    if (drag.hover === tasksListArea()) {
        // 오늘 할 일 목록에 놓으면 그 자리로 순서가 정해진다 (이 목록의 줄이었는지는 끌기를 시작한 줄이 어디 있는지로 안다)
        dropTaskOnList(drag.task, drag.insertIndex || 0, todayTasksList.contains(drag.item));
        return;
    }
    const hoverDate = drag.hover.dataset ? drag.hover.dataset.date : null;
    if (hoverDate) {
        assignTaskDate(drag.task, hoverDate);  // 작은 달력의 날짜 칸(data-date)이면 그 날짜로 정한다
    } else if (drag.from === "inbox") {
        assignTaskDate(drag.task, viewedDate);  // 가운데 "할 일" 칸이면 보고 있는 날짜로 정한다
    } else {
        updateTask(drag.task.id, { date: null }, reloadTodayAndInbox);
    }
}

function endTaskDrag() {
    finishTaskDrag(true);
}

function cancelTaskDrag() {
    finishTaskDrag(false);
}

function cancelTaskDragOnEscape(e) {
    if (e.key === "Escape") {
        finishTaskDrag(false);
    }
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
    tasksHeading.textContent = isToday ? "오늘 할 일" : "할 일";
    dayTodayButton.hidden = isToday;
    syncMiniCalendar();  // 작은 달력도 보고 있는 날짜의 달로 맞추고, 그날을 표시한다

    // 그날의 시간표와 할 일은 내용이 바뀌기 전의 것이 남아 보이지 않게 먼저 비운다.
    // 시간표는 새 내용이 오면 처음 보여줄 위치(오늘이면 지금 시각 근처, 아니면 07:00)로 스크롤하도록 표시해 둔다
    closeTimelinePopover();
    timeline.date = null;
    timeline.events = [];
    timeline.plans = [];
    timeline.eventsFailed = false;
    timeline.needScroll = true;
    renderTimeline();
    todayTasksList.innerHTML = "";
    overdueSection.hidden = true;

    // 하루 메모: 보고 있던 날짜의 메모를 먼저 저장하고(아래 loadDayMemo 안에서), 이 날짜의 메모를 불러온다
    loadDayMemo(dateText);

    // 할 일은 내 컴퓨터에서 바로 오고, 일정은 Google을 거쳐 느릴 수 있다. 서로 기다리지 않게 따로 불러온다
    // (인터넷이 끊겨 일정이 실패해도 할 일과 내 계획은 보인다)
    loadTodayTasks().catch(function (error) {
        showToast("할 일을 불러오지 못했습니다: " + error.message);
    });
    loadTimeline().catch(function (error) {
        console.error("시간표를 불러오지 못했습니다:", error);
    });
}

// ----- 하루 메모 -----
// 날짜마다 하나씩 적는 자유 메모. 일정과 상관없는 그날의 생각, 챙길 것 등을 적는다. 내 컴퓨터(studyflow.db)에만 저장하고 Google에는 보내지 않는다.
// 입력을 멈추고 1초 뒤, 또는 다른 곳을 누르거나 다른 날로 넘길 때 저절로 저장된다. 내용을 모두 지우면 메모가 사라진다.
const dayMemoInput = document.getElementById("day-memo");
const dayMemoStatus = document.getElementById("day-memo-status");
const DAY_MEMO_SAVE_DELAY_MS = 1000;
const DAY_MEMO_MAX = 20000;  // 서버(app.py의 DAY_MEMO_MAX)와 같은 값
dayMemoInput.maxLength = DAY_MEMO_MAX;

let dayMemoDate = null;     // 입력 칸의 글이 어느 날짜의 것인지. null이면 불러오는 중이라 칸을 쓸 수 없다
let dayMemoSaved = "";      // 서버에 저장된 것으로 아는 내용
let dayMemoTimer = null;    // "입력을 멈추고 1초 뒤 저장"을 기다리는 타이머
// 저장 요청들을 한 줄로 세워 하나씩 보낸다. 날짜를 빠르게 넘길 때 요청이 뒤섞여 옛 내용이 새 내용을 덮어쓰는 일을 막으려는 것이다.
// Promise는 "나중에 끝나는 일"을 담는 자바스크립트 상자이고, .then(...)으로 "이 일이 끝나면 다음 일"을 이어 붙인다
let dayMemoQueue = Promise.resolve();

function setDayMemoStatus(text, isError) {
    dayMemoStatus.textContent = text;
    dayMemoStatus.classList.toggle("error", Boolean(isError));
}

// 입력 칸의 내용을 저장한다. 바뀐 게 없으면 아무것도 하지 않는다.
// keepalive가 true면(창이 닫히는 중) 줄을 서지 않고 바로 보내고, 창이 닫혀도 요청이 끝까지 가도록 한다
function saveDayMemo(keepalive) {
    clearTimeout(dayMemoTimer);
    if (dayMemoDate === null || dayMemoInput.value === dayMemoSaved) {
        return dayMemoQueue;
    }
    // 보내는 순간의 날짜와 내용을 지금 붙잡아 둔다. 줄을 서서 기다리는 사이에 날짜가 바뀌어도 이 날짜에 저장되어야 한다
    const date = dayMemoDate;
    const content = dayMemoInput.value;
    setDayMemoStatus("저장 중…");

    async function send() {
        try {
            const response = await fetch("/api/day-memo", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date: date, content: content }),
                keepalive: Boolean(keepalive),
            });
            if (!response.ok) {
                throw new Error(await errorMessageFrom(response));
            }
            if (dayMemoDate === date) {
                dayMemoSaved = content;
                // 보내는 사이에 더 썼다면 아직 "수정 중"이다 (곧 다음 저장이 일어난다)
                setDayMemoStatus(dayMemoInput.value === content ? "저장됨" : "수정 중…");
            }
        } catch (error) {
            showToast("메모를 저장하지 못했습니다: " + error.message);
            if (dayMemoDate === date) {
                setDayMemoStatus("저장 실패", true);
                dayMemoTimer = setTimeout(saveDayMemo, 5000);  // 5초 뒤 다시 시도한다
            }
        }
    }

    if (keepalive) {
        return send();
    }
    dayMemoQueue = dayMemoQueue.then(send);  // send는 오류를 스스로 처리하므로 줄이 중간에 끊기지 않는다
    return dayMemoQueue;
}

// dateText 날짜의 메모를 불러와 입력 칸에 채운다. 날짜가 바뀔 때마다(showDay) 부른다
async function loadDayMemo(dateText) {
    // 보고 있던 날짜의 메모에 저장 안 한 글이 있으면, 칸을 비우기 전에 먼저 저장 요청을 줄에 세운다
    saveDayMemo();
    dayMemoDate = null;
    dayMemoSaved = "";
    dayMemoInput.value = "";
    dayMemoInput.disabled = true;
    setDayMemoStatus("");
    try {
        await dayMemoQueue;  // 방금 세운 저장이 끝난 뒤에 읽어야 같은 날로 돌아왔을 때 옛 내용이 보이지 않는다
        const response = await fetch("/api/day-memo?date=" + dateText);
        if (!response.ok) {
            throw new Error(await errorMessageFrom(response));
        }
        const data = await response.json();
        if (dateText !== viewedDate) {
            return;  // 그 사이 다른 날로 넘어갔다
        }
        dayMemoDate = dateText;
        dayMemoSaved = data.content;
        dayMemoInput.value = data.content;
        dayMemoInput.disabled = false;
    } catch (error) {
        console.error("하루 메모를 불러오지 못했습니다:", error);
        if (dateText === viewedDate) {
            // 못 읽은 채로 쓰면 기존 메모를 덮어쓸 수 있으므로 칸을 잠가 둔다
            setDayMemoStatus("불러오지 못했어요", true);
        }
    }
}

dayMemoInput.addEventListener("input", function () {
    setDayMemoStatus("수정 중…");
    clearTimeout(dayMemoTimer);
    dayMemoTimer = setTimeout(saveDayMemo, DAY_MEMO_SAVE_DELAY_MS);
});
// 다른 곳을 누르면 기다리지 않고 바로 저장한다
dayMemoInput.addEventListener("blur", function () {
    saveDayMemo();
});
// 창이 가려지거나 닫히기 직전에 저장 안 한 글이 있으면 서둘러 저장한다
document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
        saveDayMemo(true);
    }
});
window.addEventListener("pagehide", function () {
    saveDayMemo(true);
});

// 오늘 탭을 처음 열 때 실행된다 (탭을 누를 때마다). 항상 "진짜 오늘"로 시작한다
async function loadToday() {
    todayText = toDateText(new Date());

    // 숨길 캘린더 목록(hiddenCalendarIds)이 설정에서 불러와진 뒤에 일정을 걸러야 한다
    await settingsReady;
    loadTimelineZoom();  // 저장해 둔 시간표 확대 정도 (처음 한 번만)

    // 달력에서 특정 날짜를 보려고 온 것이면 그 날짜를, 아니면 오늘을 보여준다 (탭을 열 때마다 오늘로 돌아오는 원래 동작은 그대로)
    showDay(pendingTodayDate || todayText);
    pendingTodayDate = null;

    // 오른쪽 "할 일 목록"(날짜 없는 할 일)도 새로 불러온다
    loadInbox().catch(function (error) {
        showToast("할 일 목록을 불러오지 못했습니다: " + error.message);
    });

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
const ddaySwatchRow = document.getElementById("dday-swatch-row");
const ddaySwatches = document.getElementById("dday-color-swatches");
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
    renderDdaySwatches();
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
const projectMemoInput = document.getElementById("project-memo");
const projectNameInput = document.getElementById("project-name");
const projectDeadlineInput = document.getElementById("project-deadline");
const projectColorInput = document.getElementById("project-color");
const projectSwatchRow = document.getElementById("project-swatch-row");
const projectSwatches = document.getElementById("project-color-swatches");
const projectError = document.getElementById("project-error");
const projectDeleteButton = document.getElementById("project-delete");
const projectFolderSelect = document.getElementById("project-folder");
const folderDialog = document.getElementById("folder-dialog");
const folderDialogTitle = document.getElementById("folder-dialog-title");
const folderNameInput = document.getElementById("folder-name");
const folderError = document.getElementById("folder-error");
const folderDeleteButton = document.getElementById("folder-delete");

// 새 프로젝트 창에 미리 골라둘 색들 (서버의 PROJECT_COLORS와 같은 목록). 프로젝트 수에 따라 차례로 쓴다
const PROJECT_COLORS = ["#4a7cff", "#e8590c", "#2f9e44", "#ae3ec9", "#d6336c", "#1098ad", "#f08c00"];

// 마지막으로 서버에서 받은 프로젝트 목록 (마감일 순). 화면을 다시 그리거나 선택 칸을 채울 때 쓴다
let projectsCache = [];
// 마지막으로 서버에서 받은 폴더 목록 (만든 순서). 프로젝트는 folderId로 어느 폴더에 들어 있는지 알려준다 (폴더 없음은 null)
let foldersCache = [];
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
async function loadProjects(options) {
    // 프로젝트와 폴더를 동시에 받는다
    const [projectsResponse, foldersResponse] = await Promise.all([fetch("/api/projects"), fetch("/api/folders")]);
    if (!projectsResponse.ok) {
        throw new Error("서버 오류: " + projectsResponse.status);
    }
    if (!foldersResponse.ok) {
        throw new Error("서버 오류: " + foldersResponse.status);
    }
    projectsCache = await projectsResponse.json();
    foldersCache = await foldersResponse.json();
    renderProjects(options);  // options: 카드가 빠지거나 옮겨졌을 때의 "다시 쌓기 + 미끄러지는 움직임" 옵션 (renderProjects 설명 참고)
    fillProjectSelect();
}

// 오늘 탭 입력줄의 프로젝트 선택 칸을 프로젝트 목록으로 채운다. 고르고 있던 프로젝트는 그대로 유지한다
function fillProjectSelect() {
    const previous = taskProjectSelect.value;
    taskProjectSelect.innerHTML = "";
    taskProjectSelect.add(new Option("프로젝트 없음", ""));
    // 폴더에 없는 프로젝트를 먼저 놓고, 폴더에 든 프로젝트는 폴더 이름의 묶음(optgroup)으로 보여준다
    projectsCache.filter(function (project) {
        return project.folderId === null;
    }).forEach(function (project) {
        taskProjectSelect.add(new Option(project.name, project.id));
    });
    foldersCache.forEach(function (folder) {
        const inside = projectsCache.filter(function (project) {
            return project.folderId === folder.id;
        });
        if (inside.length === 0) {
            return;
        }
        const group = document.createElement("optgroup");
        group.label = folder.name;
        inside.forEach(function (project) {
            group.appendChild(new Option(project.name, project.id));
        });
        taskProjectSelect.appendChild(group);
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

// 줄 안에서 바로 쓰는 메모 (프로젝트 카드의 메모, 할 일 줄의 메모가 함께 쓴다).
// 메모가 있으면 작은 회색 글씨로 보이고, 글자를 누르면 그 자리에서 고친다. 일정 메모와 같은 방식이다:
// Enter를 누르면 저장하고 입력을 끝내고(줄바꿈은 Shift+Enter, 한글 조합 중의 Enter는 글자 확정이라 건드리지 않는다),
// 입력을 멈추고 1.5초가 지나거나 다른 곳을 눌러도, Esc를 눌러도 저장한다. 모두 지우면 메모가 사라진다.
// options:
//   text: 처음 메모 / placeholder: 입력 칸의 예시 글자 / maxLength: 최대 글자 수 (서버와 같은 값)
//   boxClass, viewClass, inputClass: 상자, 메모 글자, 입력 칸에 붙일 CSS 이름 (모양은 style.css)
//   addClass, addTitle: 메모가 없을 때 보여줄 [+ 메모] 버튼의 CSS 이름과 설명. 안 주면 버튼 없이 빈 상자가 된다
//     (이때는 바깥에서 box.startEditing()을 불러서 입력을 시작한다. 할 일 줄의 "메모" 버튼이 그렇게 쓴다)
//   save(text): 서버에 저장하는 함수 (async). 실패하면 던지면 된다. 이 함수가 던지는 오류 글은 알림으로 보여준다
const INLINE_MEMO_SAVE_DELAY_MS = 1500;
const PROJECT_MEMO_MAX = 5000;  // 서버(app.py의 PROJECT_MEMO_MAX)와 같은 값
const TASK_MEMO_MAX = 2000;  // 서버(app.py의 TASK_MEMO_MAX)와 같은 값

function makeInlineMemo(options) {
    const box = document.createElement("div");
    box.className = options.boxClass;
    // text: 화면에 보이는 메모, saved: 서버에 저장된 것으로 아는 메모. 둘이 다르면 아직 저장 전(또는 저장 실패)이다
    const memo = { text: options.text || "", saved: options.text || "", saving: false, again: false, failed: false };

    // 메모를 글자로 보여주는 상태로 그린다 (입력 칸이 있었다면 걷어낸다)
    function render() {
        box.replaceChildren();
        if (memo.text) {
            const view = document.createElement("div");
            view.className = options.viewClass + (memo.failed ? " unsaved" : "");
            view.textContent = memo.text;  // textContent: 메모에 < > 같은 글자가 있어도 HTML로 해석되지 않는다
            view.title = memo.failed ? "저장되지 않았어요. 눌러서 고치면 다시 저장합니다" : "눌러서 메모 고치기";
            view.addEventListener("click", startEditing);
            box.appendChild(view);
        } else if (options.addClass) {
            const add = document.createElement("button");
            add.type = "button";
            add.className = options.addClass;
            add.textContent = "+ 메모";
            add.title = options.addTitle;
            add.addEventListener("click", startEditing);
            box.appendChild(add);
        }
    }

    // 서버에 저장한다. 저장하는 사이에 또 고쳤으면 끝난 뒤 한 번 더 저장한다
    async function save() {
        if (memo.saving) {
            memo.again = true;
            return;
        }
        if (memo.text === memo.saved) {
            return;
        }
        memo.saving = true;
        memo.failed = false;
        const text = memo.text;
        try {
            await options.save(text);
            memo.saved = text;
        } catch (error) {
            memo.failed = true;
            showToast("메모를 저장하지 못했습니다: " + error.message);
        } finally {
            memo.saving = false;
            if (!box.querySelector("textarea")) {
                render();  // 저장 결과(실패 표시)를 반영한다
            }
            if (memo.again) {
                memo.again = false;
                if (!memo.failed) {
                    save();
                }
            }
        }
    }

    function startEditing() {
        if (box.querySelector("textarea")) {
            return;
        }
        box.replaceChildren();
        const input = document.createElement("textarea");
        input.className = options.inputClass;
        input.rows = 1;
        input.maxLength = options.maxLength;
        input.placeholder = options.placeholder;
        input.value = memo.text;
        box.appendChild(input);

        // 글이 늘어나는 만큼 입력 칸도 높아진다 (+2는 위아래 테두리)
        function fitHeight() {
            input.style.height = "auto";
            input.style.height = (input.scrollHeight + 2) + "px";
        }
        fitHeight();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);  // 커서를 글 맨 끝에

        let timer = null;
        input.addEventListener("input", function () {
            fitHeight();
            clearTimeout(timer);
            timer = setTimeout(function () {
                memo.text = input.value.trim();
                save();
            }, INLINE_MEMO_SAVE_DELAY_MS);
        });
        // 입력 칸을 벗어나면(다른 곳을 누르거나 Enter, Esc) 바로 저장하고 글자로 보여주는 상태로 돌아간다
        input.addEventListener("blur", function () {
            clearTimeout(timer);
            memo.text = input.value.trim();
            render();
            save();
        });
        input.addEventListener("keydown", function (e) {
            if (e.isComposing) {
                return;
            }
            if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                input.blur();
            }
        });
    }

    box.startEditing = startEditing;
    render();
    return box;
}

// 프로젝트 카드의 메모: 진행률 아래. 메모가 없으면 카드에 마우스를 올렸을 때 나오는 [+ 메모]를 눌러서 쓴다. 수정 창(수정 버튼)에도 같은 메모 칸이 있다.
function makeProjectMemo(project) {
    return makeInlineMemo({
        text: project.memo,
        placeholder: "예: 제출 형식, 연락처, 참고 링크",
        maxLength: PROJECT_MEMO_MAX,
        boxClass: "project-memo-box",
        viewClass: "project-memo",
        inputClass: "project-memo-input",
        addClass: "project-memo-add",
        addTitle: "이 프로젝트에 메모 붙이기",
        save: async function (text) {
            await sendRequest("/api/projects/" + project.id, "PATCH", { memo: text });
            project.memo = text;  // 수정 창이 열 때 읽는 값도 맞춰 둔다
        },
    });
}

// 프로젝트 카드 하나를 만든다
function makeProjectCard(project) {
    const card = document.createElement("div");
    card.className = "project-card";
    card.dataset.projectId = project.id;  // 카드가 어느 열에 있었는지 기억할 때 쓰는 이름표 (아래 "프로젝트 카드 배치")
    card.style.borderLeftColor = project.color;

    // 맨 윗줄: 이름, 마감일, 수정 버튼
    const head = document.createElement("div");
    head.className = "project-card-head";
    // 카드의 맨 윗줄(이름이 있는 줄)을 잡고 끌면 폴더로 옮길 수 있다. 폴더가 하나도 없으면 옮길 곳이 없으니 끌기를 켜지 않는다
    if (foldersCache.length > 0) {
        card.classList.add("draggable");
        head.addEventListener("pointerdown", function (e) {
            beginProjectDrag(e, head, card, project);
        });
    }

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
        detail.textContent = "단계 " + project.doneCount + " / " + project.total + " 완료";
    }
    card.appendChild(detail);

    card.appendChild(makeProjectMemo(project));

    // 단계 순서를 직접 정해 둔 카드에는 "마감일 순으로" 버튼이 있는 줄을 보여 준다. 누르면 직접 정한 순서를 모두 지워서
    // 단계들이 다시 마감일이 빠른 순으로 보인다 (서버의 DELETE /steps/order). 순서를 정하지 않은 카드에는 나오지 않는다.
    function hasManualOrder(steps) {
        const open = steps.filter(function (step) {
            return step.done !== 1;
        });
        return open.length >= 2 && open.some(function (step) {
            return step.step_order !== null;
        });
    }
    if (hasManualOrder(project.tasks) || project.tasks.some(function (step) {
        return hasManualOrder(step.children);
    })) {
        const orderRow = document.createElement("div");
        orderRow.className = "steps-order-row";
        const orderText = document.createElement("span");
        orderText.textContent = "단계를 직접 정한 순서로 보고 있습니다";
        const orderReset = document.createElement("button");
        orderReset.textContent = "마감일 순으로";
        orderReset.title = "직접 정한 단계 순서를 지우고, 마감일이 빠른 순으로 되돌립니다";
        orderReset.addEventListener("click", async function () {
            try {
                await sendRequest("/api/projects/" + project.id + "/steps/order", "DELETE");
            } catch (error) {
                showToast("순서를 되돌리지 못했습니다: " + error.message);
            }
            await loadProjects();
        });
        orderRow.append(orderText, orderReset);
        card.appendChild(orderRow);
    }

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
            dragFrom: step.done === 1 ? null : "step",  // 끝내지 않은 단계는 끌어서 순서를 바꿀 수 있다
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
                subList.appendChild(makeTaskRow(child, stepOptions(child, { dragFrom: child.done === 1 ? null : "step" })));
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

// ----- 프로젝트 카드 배치: 열 수와 "빈틈 없이 쌓기" -----
// 카드는 높이가 제각각이라, 격자(행과 열)로 놓으면 키가 큰 카드 옆에 빈 자리가 크게 남는다. 그래서 열(세로줄)마다 카드를 위에서부터
// 차곡차곡 쌓는다(벽돌 쌓기 모양). 새 카드는 그 순간 가장 짧은 열에 놓는다.
// 카드를 고칠 때마다 화면을 다시 그리는데, 그때마다 카드가 다른 열로 튀면 어지러우므로 카드가 있던 열은 기억해서 그대로 둔다
// (열 수나 창 폭이 바뀌면 처음부터 다시 쌓는다). 한 열 안에서는 항상 원래 순서(마감일 순)를 지킨다.

let projectGrids = [];                    // 지금 화면에 있는 카드 묶음들 [{ grid, cards }]. renderProjects가 채운다
const projectColumnMemory = new Map();    // 프로젝트 번호 → 마지막으로 놓인 열 번호
let lastProjectColumnCount = 0;

// 지금 몇 열로 놓을지. 창이 900px보다 좁으면 설정과 상관없이 1열이다
function projectColumnCount() {
    if (window.innerWidth < 900) {
        return 1;
    }
    const total = [2, 3, 4].includes(settings.projectColumns) ? settings.projectColumns : 2;
    return total / projectFolderColumns();  // 폴더를 2열로 놓으면 폴더 안의 카드 열은 그만큼 줄어든다 (4열 ÷ 2 = 2열)
}

// 폴더를 몇 열로 놓을지. 2열은 카드 열 수가 4일 때만, 폴더가 있고 창이 충분히 넓을 때만 적용된다
function projectFolderColumns() {
    if (window.innerWidth < 900 || foldersCache.length === 0) {
        return 1;
    }
    return settings.projectFolderColumns === 2 && settings.projectColumns === 4 ? 2 : 1;
}

// 폴더 열 수에 맞춰 목록 상자에 표시(CSS 클래스)를 붙이거나 뗀다. 실제 두 줄 배치는 CSS가 한다
function applyProjectListColumns() {
    projectListElement.classList.toggle("two-folder-columns", projectFolderColumns() === 2);
}

// 프로젝트 카드들을 한 줄에 몇 개씩 늘어놓을 상자를 만든다. 실제로 열에 나눠 놓는 일은 layoutProjectGrids가 한다
function makeProjectGrid(projects) {
    const grid = document.createElement("div");
    grid.className = "project-grid";
    const cards = projects.map(makeProjectCard);
    projectGrids.push({ grid: grid, cards: cards });
    return grid;
}

// 화면에 있는 모든 카드 묶음을 열에 나눠 쌓는다. 화면에 붙은 뒤에 불러야 높이를 잴 수 있다
function layoutProjectGrids() {
    const count = projectColumnCount();
    if (count !== lastProjectColumnCount) {
        projectColumnMemory.clear();  // 열 수가 바뀌었으니 처음부터 다시 쌓는다
        lastProjectColumnCount = count;
    }
    projectGrids.forEach(function (entry) {
        const grid = entry.grid;
        grid.replaceChildren();
        const columns = [];
        for (let i = 0; i < count; i++) {
            const column = document.createElement("div");
            column.className = "project-column";
            grid.appendChild(column);
            columns.push(column);
        }

        // 탭이 숨겨져 있으면(오늘 탭에서 목록을 새로 받는 경우 등) 높이를 잴 수 없다. 그때는 번갈아 놓기만 하고 기억하지 않는다.
        // 프로젝트 탭을 열면 목록을 다시 받아서 그때 제대로 쌓는다
        if (grid.clientWidth === 0) {
            entry.cards.forEach(function (card, index) {
                columns[index % count].appendChild(card);
            });
            return;
        }

        const columnOf = new Map();  // 카드 → 열 번호
        // 1단계: 기억해 둔 자리가 있는 카드는 그 열에 둔다
        const fresh = [];
        entry.cards.forEach(function (card) {
            const remembered = projectColumnMemory.get(card.dataset.projectId);
            if (remembered !== undefined && remembered < count) {
                columns[remembered].appendChild(card);
                columnOf.set(card, remembered);
            } else {
                fresh.push(card);
            }
        });
        // 2단계: 새 카드는 그 순간 가장 짧은 열에 둔다 (높이는 실제로 놓아 보고 잰다)
        fresh.forEach(function (card) {
            let shortest = 0;
            columns.forEach(function (column, index) {
                if (column.offsetHeight < columns[shortest].offsetHeight) {
                    shortest = index;
                }
            });
            columns[shortest].appendChild(card);
            columnOf.set(card, shortest);
        });
        // 3단계: 각 열 안에서 원래 순서(마감일 순)로 다시 줄 세우고, 자리를 기억해 둔다
        entry.cards.forEach(function (card) {
            columns[columnOf.get(card)].appendChild(card);  // 이미 붙어 있는 요소를 다시 붙이면 맨 아래로 옮겨진다
            projectColumnMemory.set(card.dataset.projectId, columnOf.get(card));
        });
    });
}

// 창 크기가 바뀌면 다시 쌓는다 (폭이 바뀌면 카드 높이가 달라지고, 900px 경계를 넘으면 열 수가 바뀐다). 프로젝트 탭을 보고 있을 때만
let projectResizeTimer = null;
window.addEventListener("resize", function () {
    clearTimeout(projectResizeTimer);
    projectResizeTimer = setTimeout(function () {
        if (document.getElementById("projects").classList.contains("active")) {
            applyProjectListColumns();  // 900px 경계를 넘으면 폴더 열 수도 달라진다
            layoutProjectGrids();
        }
    }, 150);
});

// 폴더 하나의 구역을 만든다: 머리글(접기/펴기, 이름, 요약, 버튼들)과, 펼쳐져 있으면 그 안의 프로젝트 카드들
function makeFolderSection(folder, projects) {
    const section = document.createElement("section");
    section.className = "folder-section" + (folder.collapsed ? " collapsed" : "");
    section.dataset.folderId = folder.id;

    const head = document.createElement("div");
    head.className = "folder-head";
    head.tabIndex = 0;
    head.setAttribute("role", "button");
    head.setAttribute("aria-expanded", String(!folder.collapsed));

    const arrow = document.createElement("span");
    arrow.className = "folder-arrow";
    arrow.textContent = folder.collapsed ? "▸" : "▾";

    const name = document.createElement("span");
    name.className = "folder-name";
    name.textContent = folder.name;

    // 요약: "프로젝트 5개 · 평균 62% · 임박 2". 접어 두어도 이 한 줄로 상황을 알 수 있다
    const summary = document.createElement("span");
    summary.className = "folder-summary";
    if (projects.length === 0) {
        summary.textContent = "비어 있음";
    } else {
        const average = Math.round(projects.reduce(function (sum, project) {
            return sum + project.percent;
        }, 0) / projects.length);
        summary.textContent = "프로젝트 " + projects.length + "개 · 평균 " + average + "%";
        // 마감이 7일 이내이거나 지났는데 아직 안 끝난 프로젝트의 수
        const urgentCount = projects.filter(function (project) {
            return project.deadline && project.percent < 100 && describeDeadline(project.deadline).urgent;
        }).length;
        if (urgentCount > 0) {
            const urgent = document.createElement("span");
            urgent.className = "folder-urgent";
            urgent.textContent = "임박 " + urgentCount;
            summary.append(" · ", urgent);
        }
    }

    const addButton = document.createElement("button");
    addButton.textContent = "+ 프로젝트";
    addButton.title = "이 폴더에 새 프로젝트 만들기";
    addButton.addEventListener("click", function (e) {
        e.stopPropagation();  // 머리글 전체를 누르면 접히는데, 버튼을 누른 것은 접기가 아니다
        openProjectDialog(null, { folderId: folder.id });
    });
    const editButton = document.createElement("button");
    editButton.textContent = "수정";
    editButton.title = "폴더 이름 바꾸기, 삭제";
    editButton.addEventListener("click", function (e) {
        e.stopPropagation();
        openFolderDialog(folder);
    });
    head.append(arrow, name, summary, addButton, editButton);

    function toggle() {
        toggleFolder(folder);
    }
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", function (e) {
        // 머리글 안의 버튼에서 누른 Enter/Space는 그 버튼의 일이다
        if ((e.key === "Enter" || e.key === " ") && e.target === head) {
            e.preventDefault();
            toggle();
        }
    });
    section.appendChild(head);

    if (!folder.collapsed) {
        if (projects.length > 0) {
            const body = makeProjectGrid(projects);
            body.classList.add("folder-body");
            section.appendChild(body);
        } else {
            const empty = document.createElement("p");
            empty.className = "folder-empty";
            empty.textContent = "이 폴더에는 프로젝트가 없습니다. '+ 프로젝트'로 만들거나, 다른 프로젝트 카드의 맨 윗줄을 끌어다 놓아 주세요.";
            section.appendChild(empty);
        }
    }
    return section;
}

// 폴더를 접거나 편다. 화면에는 먼저 반영하고, 저장에 실패하면 알린다
function toggleFolder(folder) {
    folder.collapsed = !folder.collapsed;
    renderProjects();
    sendRequest("/api/folders/" + folder.id, "PATCH", { collapsed: folder.collapsed }).catch(function (error) {
        showToast("폴더 상태를 저장하지 못했습니다: " + error.message);
    });
}

// ----- 프로젝트를 폴더로 끌어다 놓기 -----
// 우선순위 탭의 끌기와 같은 방식(포인터 이벤트, 새 라이브러리 없음).
// 카드 맨 윗줄을 잡고 끌면 이름표(ghost)가 마우스를 따라다니고, 놓을 수 있는 폴더 구역이 점선으로 강조된다.
// 폴더 구역 어디에나(머리글, 접힌 폴더, 카드들 사이 빈 곳) 놓을 수 있고, "폴더 없음" 구역에 놓으면 폴더에서 뺀다

const PROJECT_DRAG_THRESHOLD = 4;  // 이만큼(px) 움직여야 끌기로 본다. 그보다 적으면 그냥 누른 것
let projectDrag = null;            // 끄는 중에만 값이 있다: { project, card, head, startX, startY, ghost, hover, tempZone }

function beginProjectDrag(e, head, card, project) {
    if (e.pointerType === "mouse" && e.button !== 0) {
        return;
    }
    if (e.target.closest("button")) {
        return;  // 머리줄의 "수정" 버튼을 누른 것은 끌기가 아니다
    }
    projectDrag = {
        project: project, card: card, head: head, startX: e.clientX, startY: e.clientY,
        ghost: null, hover: null, tempZone: null,
    };
    // 마우스가 머리줄 밖으로 나가도 계속 이 줄이 이벤트를 받게 한다
    head.setPointerCapture(e.pointerId);
    head.addEventListener("pointermove", moveProjectDrag);
    head.addEventListener("pointerup", endProjectDrag);
    head.addEventListener("pointercancel", cancelProjectDrag);
    document.addEventListener("keydown", cancelProjectDragOnEscape);
}

// 구역의 폴더 번호. "폴더 없음" 구역은 null
function folderIdOfSection(section) {
    return section.classList.contains("loose") ? null : Number(section.dataset.folderId);
}

// 마우스 아래에 있는 폴더 구역을 찾는다. (ghost는 pointer-events: none이라 아래가 보인다)
function projectDropTarget(x, y) {
    const element = document.elementFromPoint(x, y);
    const section = element ? element.closest(".folder-section") : null;
    return section && projectListElement.contains(section) ? section : null;
}

function startProjectDragVisuals(drag) {
    drag.ghost = document.createElement("div");
    drag.ghost.className = "project-ghost";
    drag.ghost.style.borderLeftColor = drag.project.color;
    drag.ghost.textContent = drag.project.name;
    document.body.appendChild(drag.ghost);
    drag.card.classList.add("drag-source");
    document.body.classList.add("project-dragging");
    // 이 프로젝트가 폴더 안에 있고 "폴더 없음" 구역이 아직 없으면, 폴더에서 뺄 수 있게 끄는 동안만 그 구역을 맨 아래에 만든다
    if (drag.project.folderId !== null && !projectListElement.querySelector(".folder-section.loose")) {
        const zone = document.createElement("section");
        zone.className = "folder-section loose temp-zone";
        const zoneHead = document.createElement("div");
        zoneHead.className = "folder-head static";
        const zoneName = document.createElement("span");
        zoneName.className = "folder-name";
        zoneName.textContent = "폴더 없음";
        const zoneHint = document.createElement("span");
        zoneHint.className = "folder-summary";
        zoneHint.textContent = "여기에 놓으면 폴더에서 뺍니다";
        zoneHead.append(zoneName, zoneHint);
        zone.appendChild(zoneHead);
        projectListElement.appendChild(zone);
        drag.tempZone = zone;
    }
}

function moveProjectDrag(e) {
    const drag = projectDrag;
    if (!drag) {
        return;
    }
    if (!drag.ghost) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < PROJECT_DRAG_THRESHOLD) {
            return;
        }
        startProjectDragVisuals(drag);
    }
    drag.ghost.style.left = (e.clientX + 14) + "px";
    drag.ghost.style.top = (e.clientY + 14) + "px";

    // 놓을 수 있는 구역을 강조한다. 지금 들어 있는 폴더는 옮길 필요가 없으니 강조하지 않는다
    let target = projectDropTarget(e.clientX, e.clientY);
    if (target && folderIdOfSection(target) === drag.project.folderId) {
        target = null;
    }
    if (target !== drag.hover) {
        if (drag.hover) {
            drag.hover.classList.remove("drop-hover");
        }
        if (target) {
            target.classList.add("drop-hover");
        }
        drag.hover = target;
    }

    // 화면 위나 아래 끝 근처로 가면 페이지를 스크롤한다 (폴더가 많으면 목표 폴더가 화면 밖일 수 있다)
    if (e.clientY < 50) {
        window.scrollBy(0, -14);
    } else if (e.clientY > window.innerHeight - 50) {
        window.scrollBy(0, 14);
    }
}

// 끌기를 마무리한다. drop이 true이고 놓을 수 있는 구역 위였다면 그 폴더로 옮긴다
function finishProjectDrag(drop) {
    const drag = projectDrag;
    if (!drag) {
        return;
    }
    projectDrag = null;
    drag.head.removeEventListener("pointermove", moveProjectDrag);
    drag.head.removeEventListener("pointerup", endProjectDrag);
    drag.head.removeEventListener("pointercancel", cancelProjectDrag);
    document.removeEventListener("keydown", cancelProjectDragOnEscape);
    document.body.classList.remove("project-dragging");
    drag.card.classList.remove("drag-source");
    if (drag.ghost) {
        drag.ghost.remove();
    }
    if (drag.tempZone) {
        drag.tempZone.remove();
    }
    const target = drag.hover;
    if (target) {
        target.classList.remove("drop-hover");
    }
    if (drop && target) {
        moveProjectToFolder(drag.project, folderIdOfSection(target));
    }
}

function endProjectDrag() {
    finishProjectDrag(true);
}

function cancelProjectDrag() {
    finishProjectDrag(false);
}

function cancelProjectDragOnEscape(e) {
    if (e.key === "Escape") {
        finishProjectDrag(false);
    }
}

// 프로젝트를 다른 폴더(또는 폴더 없음)로 옮긴다. 화면에 먼저 반영하고, 저장에 실패하면 되돌린다
async function moveProjectToFolder(project, folderId) {
    const previous = project.folderId;
    project.folderId = folderId;
    renderProjects({ animate: true, repackFolderIds: [previous, folderId] });  // 빠진 폴더의 빈틈이 메워지고 들어간 폴더에 자리가 생기도록 두 폴더를 다시 쌓는다
    const folder = foldersCache.find(function (item) {
        return item.id === folderId;
    });
    try {
        await sendRequest("/api/projects/" + project.id, "PATCH", { folderId: folderId });
        // 접힌 폴더로 옮기면 카드가 사라져 보이므로, 잘 갔다는 것을 알려 준다
        showToast("'" + project.name + "'을(를) " + (folder ? "'" + folder.name + "' 폴더로" : "폴더 밖으로") + " 옮겼습니다");
    } catch (error) {
        project.folderId = previous;
        renderProjects({ animate: true, repackFolderIds: [previous, folderId] });
        showToast("프로젝트를 옮기지 못했습니다: " + error.message);
    }
}

// 카드들의 지금 위치를 기억해 둔다 (프로젝트 번호 → 문서 전체 기준 위치). 다시 쌓은 뒤 "어디서 어디로 갔는지" 알아내려는 것이다
function snapshotProjectCards() {
    const positions = new Map();
    document.querySelectorAll("#project-list .project-card").forEach(function (card) {
        const rect = card.getBoundingClientRect();
        if (rect.width > 0) {
            positions.set(card.dataset.projectId, { left: rect.left + window.scrollX, top: rect.top + window.scrollY });
        }
    });
    return positions;
}

// 카드들이 옛 위치에서 새 위치로 스르륵 미끄러지게 한다. 요즘 많이 쓰는 FLIP 기법이다:
// First(옛 위치를 재고) → Last(새 위치로 실제로 옮기고) → Invert(카드를 옛 위치로 잠깐 되돌려 놓고, transform으로 그만큼 밀어 둠) → Play(transform을 풀면 transition이 새 위치까지 움직여 줌).
// 카드는 이미 새 위치에 있으므로 중간에 멈추거나 실패해도 화면이 어긋나지 않는다
function slideProjectCards(before) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;  // 움직임을 줄여 달라고 설정한 사람에게는 애니메이션 없이 바로 보여 준다
    }
    const moving = [];
    document.querySelectorAll("#project-list .project-card").forEach(function (card) {
        const old = before.get(card.dataset.projectId);
        if (!old) {
            return;
        }
        const rect = card.getBoundingClientRect();
        const dx = old.left - (rect.left + window.scrollX);
        const dy = old.top - (rect.top + window.scrollY);
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            return;
        }
        card.style.transition = "none";
        card.style.transform = "translate(" + dx + "px, " + dy + "px)";
        card.style.position = "relative";  // 움직이는 동안 이웃 카드 위로 지나가도록
        card.style.zIndex = "5";
        moving.push(card);
    });
    if (moving.length === 0) {
        return;
    }
    void document.body.offsetWidth;  // 옛 위치에 놓인 상태를 브라우저가 한 번 확정하게 한다 (이걸 읽지 않으면 움직임 없이 바로 새 위치로 간다)
    moving.forEach(function (card) {
        card.style.transition = "transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1)";
        card.style.transform = "";
        function cleanup() {
            card.style.transition = "";
            card.style.position = "";
            card.style.zIndex = "";
            card.removeEventListener("transitionend", cleanup);
        }
        card.addEventListener("transitionend", cleanup);
        setTimeout(cleanup, 600);  // transitionend가 안 오는 경우(탭 전환 등)에도 스타일을 정리한다
    });
}

let releaseProjectListHeightTimer = null;  // renderProjects가 붙잡아 둔 목록 높이를 풀어 줄 타이머

// 폴더와 프로젝트 카드들을 모두 다시 그린다.
// options.repackFolderIds: 카드가 빠지거나 들어온 폴더들의 번호(폴더 없음은 null). 이 폴더들의 카드는 "있던 열"을 잊고 처음부터 다시 쌓아서 빈틈을 메운다.
//   (평소에는 카드가 다른 열로 튀지 않게 열을 기억해 두는데, 카드가 빠졌을 때는 오히려 빈칸이 남기 때문이다)
// options.animate: true이면 카드들이 옛 위치에서 새 위치로 미끄러진다
function renderProjects(options) {
    const before = options && options.animate ? snapshotProjectCards() : null;
    if (options && options.repackFolderIds) {
        projectsCache.forEach(function (project) {
            if (options.repackFolderIds.includes(project.folderId)) {
                projectColumnMemory.delete(String(project.id));
            }
        });
    }
    // 목록을 비우고 다시 채우는 사이에 페이지 높이가 줄어서 브라우저가 스크롤을 맨 위로 되돌려 버린다.
    // 그래서 다시 그리기 전의 스크롤 위치를 기억해 두었다가, 다 그린 뒤에 돌려놓는다 (단계 체크, 단계 순서 바꾸기 등 모든 새로고침이 같다).
    // 또 새로 그린 카드는 마우스를 다시 움직이기 전까지 "마우스가 올라간 상태"가 아니라서(카드에 마우스를 올려야 보이는 [+ 메모] 버튼이 잠깐 사라져)
    // 페이지가 조금 짧아지고 스크롤이 따라 줄어든다. 그것도 막으려고, 잠시 동안 목록의 높이를 이전 높이 이상으로 붙잡아 둔다.
    const scrollY = window.scrollY;
    projectListElement.style.minHeight = projectListElement.offsetHeight + "px";
    renderProjectsNow();
    if (window.scrollY !== scrollY) {
        window.scrollTo(0, scrollY);
    }
    clearTimeout(releaseProjectListHeightTimer);
    releaseProjectListHeightTimer = setTimeout(function () {
        projectListElement.style.minHeight = "";
    }, 500);
    if (before) {
        slideProjectCards(before);
    }
}

// (renderProjects가 부르는 실제 그리기) 폴더가 하나도 없으면 예전처럼 카드만 늘어놓고, 폴더가 있으면 폴더 구역들 뒤에 "폴더 없음" 구역을 둔다
function renderProjectsNow() {
    applyProjectListColumns();
    projectListElement.innerHTML = "";
    projectGrids = [];
    if (projectsCache.length === 0 && foldersCache.length === 0) {
        const empty = document.createElement("p");
        empty.className = "today-empty";
        empty.textContent = "아직 프로젝트가 없습니다. 위의 '+ 새 프로젝트'로 만들어 보세요.";
        projectListElement.appendChild(empty);
        return;
    }

    const loose = projectsCache.filter(function (project) {
        return project.folderId === null;
    });
    if (foldersCache.length === 0) {
        projectListElement.appendChild(makeProjectGrid(loose));
        layoutProjectGrids();
        return;
    }

    foldersCache.forEach(function (folder) {
        const inside = projectsCache.filter(function (project) {
            return project.folderId === folder.id;
        });
        projectListElement.appendChild(makeFolderSection(folder, inside));
    });
    if (loose.length > 0) {
        const section = document.createElement("section");
        section.className = "folder-section loose";
        const head = document.createElement("div");
        head.className = "folder-head static";
        const name = document.createElement("span");
        name.className = "folder-name";
        name.textContent = "폴더 없음";
        const summary = document.createElement("span");
        summary.className = "folder-summary";
        summary.textContent = "프로젝트 " + loose.length + "개";
        head.append(name, summary);
        section.append(head, makeProjectGrid(loose));
        section.lastChild.classList.add("folder-body");
        projectListElement.appendChild(section);
    }
    layoutProjectGrids();  // 모두 화면에 붙인 뒤에 열에 나눠 쌓는다
}

// ----- 프로젝트 색 고르기 도우미 -----
// 1) 새 프로젝트의 기본 색: 같은 폴더에 앞 키워드(이름의 첫 띄어쓰기 앞까지)가 같은 프로젝트가 있으면 그 색으로 미리 맞춘다.
//    예: "영어 단어"와 "영어 듣기"가 빨간색이면 새로 "영어 문법"을 적을 때 빨간색이 된다. 색이 여럿이면 가장 많이 쓴 색(같으면 가장 최근 것).
//    없으면 팔레트에서 프로젝트 수에 따라 차례로 고른다. (서버의 default_project_color와 같은 규칙이다)
// 2) 쓰고 있는 색 동그라미: 다른 프로젝트들이 이미 쓰는 색을 색 칸 아래에 동그라미로 보여 주고, 누르면 그 색이 된다 (Google 문서의 "사용한 색"처럼).
// 사용자가 색을 직접 골랐으면(projectColorTouched) 이름을 고쳐도 색을 다시 바꾸지 않는다.
let projectColorTouched = false;

function firstWord(name) {
    const words = name.trim().split(/\s+/);
    return words[0].toLowerCase();
}

function suggestedProjectColor(name, folderId) {
    const word = firstWord(name);
    const colors = new Map();  // 색 → { count: 쓴 개수, newest: 그 색을 쓴 가장 큰 프로젝트 번호 }
    if (word) {
        projectsCache.forEach(function (project) {
            if (project.folderId === folderId && firstWord(project.name) === word) {
                const used = colors.get(project.color) || { count: 0, newest: 0 };
                used.count++;
                used.newest = Math.max(used.newest, project.id);
                colors.set(project.color, used);
            }
        });
    }
    let best = null;
    colors.forEach(function (used, color) {
        const bestUsed = best === null ? null : colors.get(best);
        if (best === null || used.count > bestUsed.count || (used.count === bestUsed.count && used.newest > bestUsed.newest)) {
            best = color;
        }
    });
    return best !== null ? best : PROJECT_COLORS[projectsCache.length % PROJECT_COLORS.length];
}

// 창의 폴더 칸에서 고른 폴더 번호 (폴더 없음은 null)
function dialogFolderId() {
    return projectFolderSelect.value ? Number(projectFolderSelect.value) : null;
}

// 새 프로젝트이고 색을 직접 고르지 않았다면, 지금 이름과 폴더에 맞는 기본 색으로 맞춘다
function refreshSuggestedColor() {
    if (!editingProject && !projectColorTouched) {
        projectColorInput.value = suggestedProjectColor(projectNameInput.value, dialogFolderId());
    }
    renderProjectSwatches();
}

// 지금 이미 쓰이고 있는 색들: 프로젝트와 D-day가 쓰는 색 (색 이름표 { color, name }의 목록).
// except: 지금 고치는 것 자신은 빼려는 것이다. { kind: "project" 또는 "dday", id }
function usedColorEntries(except) {
    const entries = [];
    projectsCache.forEach(function (project) {
        if (!(except.kind === "project" && except.id === project.id)) {
            entries.push({ color: project.color, name: project.name });
        }
    });
    ddaysCache.forEach(function (dday) {
        if (!(except.kind === "dday" && except.id === dday.id)) {
            entries.push({ color: dday.color, name: dday.name + " (D-day)" });
        }
    });
    return entries;
}

// 쓰고 있는 색을 많이 쓴 순서로 동그라미로 그린다 (프로젝트 창과 D-day 창이 같이 쓴다). 지금 고른 색의 동그라미에는 테두리가 생긴다.
// row: 줄 전체(동그라미가 하나도 없으면 숨긴다), box: 동그라미를 담는 상자, input: 색 칸, onPick: 동그라미를 눌러 색을 골랐을 때 부를 함수
function renderColorSwatches(row, box, input, entries, onPick) {
    const used = new Map();  // 색 → 그 색을 쓰는 이름들
    entries.forEach(function (entry) {
        const names = used.get(entry.color) || [];
        names.push(entry.name);
        used.set(entry.color, names);
    });
    const colors = Array.from(used.keys()).sort(function (a, b) {
        return used.get(b).length - used.get(a).length;  // 안정 정렬이라 같으면 처음 나온 순서를 지킨다
    });
    box.replaceChildren();
    row.hidden = colors.length === 0;
    colors.forEach(function (color) {
        const names = used.get(color);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "color-swatch" + (color === input.value.toLowerCase() ? " selected" : "");
        button.style.backgroundColor = color;
        button.dataset.color = color;
        button.title = names.slice(0, 3).join(", ") + (names.length > 3 ? " 외 " + (names.length - 3) + "개" : "") + " (" + names.length + "개가 쓰는 색)";
        button.addEventListener("click", function () {
            input.value = color;
            onPick();
        });
        box.appendChild(button);
    });
}

function renderProjectSwatches() {
    renderColorSwatches(projectSwatchRow, projectSwatches, projectColorInput,
        usedColorEntries(editingProject ? { kind: "project", id: editingProject.id } : {}),
        function () {
            projectColorTouched = true;
            renderProjectSwatches();
        });
}

function renderDdaySwatches() {
    renderColorSwatches(ddaySwatchRow, ddaySwatches, ddayColorInput,
        usedColorEntries(editingDday ? { kind: "dday", id: editingDday.id } : {}),
        renderDdaySwatches);
}
ddayColorInput.addEventListener("input", renderDdaySwatches);

projectNameInput.addEventListener("input", refreshSuggestedColor);
projectFolderSelect.addEventListener("change", refreshSuggestedColor);
projectColorInput.addEventListener("input", function () {
    projectColorTouched = true;  // 직접 고른 색은 이름을 고쳐도 바꾸지 않는다
    renderProjectSwatches();
});

// 프로젝트 추가/수정 창을 연다. project가 없으면 새 프로젝트. options.folderId는 새 프로젝트를 미리 넣어 둘 폴더다
function openProjectDialog(project, options) {
    editingProject = project || null;
    projectDeleteArmed = false;
    projectDeleteButton.textContent = "삭제";
    projectDeleteButton.hidden = !editingProject;
    projectDialogTitle.textContent = editingProject ? "프로젝트 수정" : "새 프로젝트";

    projectNameInput.value = editingProject ? editingProject.name : "";
    // 폴더 선택 칸: "폴더 없음" + 폴더들. 수정이면 지금 들어 있는 폴더, 새 프로젝트면 미리 정해진 폴더(없으면 폴더 없음)
    projectFolderSelect.innerHTML = "";
    projectFolderSelect.add(new Option("폴더 없음", ""));
    foldersCache.forEach(function (folder) {
        projectFolderSelect.add(new Option(folder.name, folder.id));
    });
    const folderId = editingProject ? editingProject.folderId : (options && options.folderId !== undefined ? options.folderId : null);
    projectFolderSelect.value = folderId === null || folderId === undefined ? "" : String(folderId);
    projectDeadlineInput.value = editingProject && editingProject.deadline ? editingProject.deadline : "";
    projectColorTouched = false;
    projectColorInput.value = editingProject ? editingProject.color : suggestedProjectColor("", dialogFolderId());
    renderProjectSwatches();
    // radio 칸 중 지금 방식에 해당하는 것을 체크한다. [value=...]는 value가 그 값인 요소를 찾는 선택자다
    const mode = editingProject ? editingProject.progressMode : "auto";
    document.querySelector('input[name="project-mode"][value="' + mode + '"]').checked = true;
    projectMemoInput.value = editingProject ? editingProject.memo : "";
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
        folderId: projectFolderSelect.value ? Number(projectFolderSelect.value) : null,
        memo: projectMemoInput.value,
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
        // 폴더를 바꿨으면 빠진 폴더와 들어간 폴더를 다시 쌓고 미끄러지게 한다
        const folderChanged = editingProject && editingProject.folderId !== body.folderId;
        await loadProjects(folderChanged ? { animate: true, repackFolderIds: [editingProject.folderId, body.folderId] } : undefined);
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
        const folderId = editingProject.folderId;
        await sendRequest("/api/projects/" + editingProject.id, "DELETE");
        projectDialog.close();
        await loadProjects({ animate: true, repackFolderIds: [folderId] });  // 지운 카드의 빈칸을 아래 카드들이 올라와 메운다
    } catch (error) {
        projectError.textContent = error.message;
    }
}

projectAddButton.addEventListener("click", function () {
    openProjectDialog(null);
});

// ----- 폴더 만들기 / 이름 바꾸기 / 지우기 -----

// 수정 중인 폴더. null이면 "새 폴더" 모드다
let editingFolder = null;
let folderDeleteArmed = false;

function openFolderDialog(folder) {
    editingFolder = folder || null;
    folderDeleteArmed = false;
    folderDeleteButton.textContent = "삭제";
    folderDeleteButton.hidden = !editingFolder;
    folderDialogTitle.textContent = editingFolder ? "폴더 수정" : "새 폴더";
    folderNameInput.value = editingFolder ? editingFolder.name : "";
    folderError.textContent = "";
    folderDialog.showModal();
    folderNameInput.focus();
    folderNameInput.select();
}

async function saveFolder() {
    const name = folderNameInput.value.trim();
    if (!name) {
        folderError.textContent = "폴더 이름을 입력하세요.";
        return;
    }
    try {
        folderError.textContent = "저장하는 중...";
        if (editingFolder) {
            await sendRequest("/api/folders/" + editingFolder.id, "PATCH", { name: name });
        } else {
            await sendRequest("/api/folders", "POST", { name: name });
        }
        folderDialog.close();
        await loadProjects();
    } catch (error) {
        folderError.textContent = error.message;
    }
}

// 폴더 삭제: 두 번 눌러야 지워진다. 안의 프로젝트는 지워지지 않고 "폴더 없음"으로 나온다
async function deleteFolder() {
    if (!folderDeleteArmed) {
        folderDeleteArmed = true;
        folderDeleteButton.textContent = "정말 삭제? (프로젝트는 '폴더 없음'으로 남음)";
        return;
    }
    try {
        await sendRequest("/api/folders/" + editingFolder.id, "DELETE");
        folderDialog.close();
        await loadProjects();
    } catch (error) {
        folderError.textContent = error.message;
    }
}

document.getElementById("folder-add-button").addEventListener("click", function () {
    openFolderDialog(null);
});
document.getElementById("folder-save").addEventListener("click", saveFolder);
document.getElementById("folder-cancel").addEventListener("click", function () {
    folderDialog.close();
});
folderDeleteButton.addEventListener("click", deleteFolder);
folderNameInput.addEventListener("keydown", function (e) {
    // 한글 조합 중의 Enter는 무시한다 (다른 입력 칸과 같은 이유)
    if (e.key === "Enter" && !e.isComposing) {
        saveFolder();
    }
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

    // 하위 단계를 가진 단계는 하위 단계들을 묶어서 하나로 보여준다. 얼마나 끝났는지 "하위 2/5 완료"로 알린다
    const progress = task.child_total > 0 ? "하위 " + task.child_done + "/" + task.child_total + " 완료" : "";

    if (variant === "row" && (task.project_name || progress)) {
        // 목록 줄에는 어느 프로젝트의 단계인지와 하위 단계 진행도를 작게 보여준다
        const sub = document.createElement("span");
        sub.className = "priority-sub";
        sub.textContent = [task.project_name, progress].filter(Boolean).join(" · ");
        item.appendChild(sub);
    }

    // 마우스를 올리면 전체 이름과 현재 평가가 보인다 (칸 안에서는 이름이 줄여져 보이므로)
    const rating = task.importance === null ? "" : "\n중요 " + task.importance + " · 긴급 " + task.urgency;
    item.title = task.content + (task.project_name ? "\n" + task.project_name : "") + (progress ? "\n" + progress : "") + deadlineText + rating;

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

    // 하위 단계가 남아 있는 단계를 완료하면 그 하위 단계들도 함께 끝낸 것이 되므로 미리 알려준다
    const openChildren = task.child_total - task.child_done;
    const doneButton = document.createElement("button");
    doneButton.textContent = "✓ 완료" + (openChildren > 0 ? " (남은 하위 " + openChildren + "개 포함)" : "");
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
        showToast("완료했어요: " + task.content + (task.child_total - task.child_done > 0 ? " (남은 하위 단계 " + (task.child_total - task.child_done) + "개 포함)" : ""));
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
const todaySliderListElement = document.getElementById("today-slider-list");
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
    timelineWidth: "--timeline-width",  // 오늘 탭 시간표 칸의 너비
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
    // 월간 캘린더의 줄 수(6 또는 7). 바뀌었고 지금 월간 보기를 보고 있다면 같은 달을 새 줄 수로 다시 그린다
    const monthRows = settings.monthRows === 7 ? 7 : 6;
    if (monthRows !== monthRowsSetting) {
        monthRowsSetting = monthRows;
        if (calendar.view.type === MONTH_VIEW) {
            gotoShownMonth(0);
        }
    }
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
        document.querySelector('input[name="month-rows"][value="' + (settings.monthRows === 7 ? 7 : 6) + '"]').checked = true;
        document.querySelector('input[name="project-columns"][value="' + ([2, 3, 4].includes(settings.projectColumns) ? settings.projectColumns : 2) + '"]').checked = true;
        document.querySelector('input[name="project-folder-columns"][value="' + (settings.projectFolderColumns === 2 ? 2 : 1) + '"]').checked = true;
        updateFolderColumnControls();
        vaultPathInput.value = settings.vaultPath || "";

        // 혹시 이미 있던 슬라이더를 비우고, 화면 크기 슬라이더와 Pomodoro 슬라이더를 각자의 칸에 만든다
        sliderListElement.innerHTML = "";
        pomodoroSliderListElement.innerHTML = "";
        todaySliderListElement.innerHTML = "";
        data.sliders.forEach(function (def) {
            buildSlider(def, sliderListElement);
        });
        (data.todaySliders || []).forEach(function (def) {
            buildSlider(def, todaySliderListElement);
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

// "기본값으로" 버튼: 그 칸의 슬라이더들을 기본값으로 되돌리고 저장한다 (기본 캘린더는 그대로 둔다)
function resetSliders(listElement) {
    listElement.querySelectorAll("input[type=range]").forEach(function (slider) {
        slider.value = slider.dataset.default;
        settings[slider.dataset.key] = Number(slider.dataset.default);
        // 슬라이더 오른쪽의 값 글자도 기본값으로 바꾼다 (nextElementSibling = 바로 다음 요소)
        slider.nextElementSibling.textContent = slider.dataset.default + slider.dataset.unit;
    });
    applySettings();
    saveSettings();
}
document.getElementById("settings-reset").addEventListener("click", function () {
    resetSliders(sliderListElement);
});
document.getElementById("today-settings-reset").addEventListener("click", function () {
    resetSliders(todaySliderListElement);
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

// 설정 탭에서 프로젝트 카드 열 수(2/3/4열)를 골랐을 때: 카드를 처음부터 다시 쌓고, 저장한다
// 월간 캘린더 줄 수: 고르면 바로 캘린더에 반영하고 저장한다
document.querySelectorAll('input[name="month-rows"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
        if (radio.checked) {
            settings.monthRows = Number(radio.value);
            applySettings();
            saveSettings();
        }
    });
});

document.querySelectorAll('input[name="project-columns"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
        if (radio.checked) {
            settings.projectColumns = Number(radio.value);
            updateFolderColumnControls();
            projectColumnMemory.clear();
            renderProjects();
            saveSettings();
        }
    });
});

// 카드 열 수가 4가 아니면 "폴더 2열"은 쓸 수 없으니 선택 칸을 흐리게 막고 이유를 알려 준다 (고른 값 자체는 그대로 저장해 둔다)
function updateFolderColumnControls() {
    const allowed = settings.projectColumns === 4;
    document.querySelector('input[name="project-folder-columns"][value="2"]').disabled = !allowed;
    document.getElementById("project-folder-columns-hint").classList.toggle("muted-off", !allowed);  // 막혔을 때 안내를 또렷하게
}

// 설정 탭에서 폴더 열 수(1/2열)를 골랐을 때
document.querySelectorAll('input[name="project-folder-columns"]').forEach(function (radio) {
    radio.addEventListener("change", function () {
        if (radio.checked) {
            settings.projectFolderColumns = Number(radio.value);
            projectColumnMemory.clear();
            renderProjects();
            saveSettings();
        }
    });
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

// 왼쪽 캘린더 목록(체크박스)을 만든다. 처음 한 번과, 캘린더를 만들거나 뺀 뒤에 다시 부른다 (그때마다 목록과 선택 칸을 비우고 새로 채운다)
async function loadCalendarList() {
    // index.html에서 만들어둔 빈 칸(<aside id="calendar-list">)
    const listElement = document.getElementById("calendar-list");

    listElement.querySelectorAll("label, .calendar-list-error").forEach(function (element) {
        element.remove();
    });
    eventCalendarSelect.innerHTML = "";
    while (defaultCalendarSelect.options.length > 1) {
        defaultCalendarSelect.remove(1);  // 맨 위 "자동" 항목만 남긴다
    }
    editableCalendars.length = 0;

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

            // 이름은 span에 넣어서 남는 폭을 차지하게 한다 (오른쪽 끝에 지우기 버튼이 올 자리)
            const nameText = document.createElement("span");
            nameText.className = "calendar-name";
            nameText.textContent = cal.name;

            // label 안에 체크박스, 색 점, 이름 글자를 차례로 넣는다
            label.append(checkbox, dot, nameText);

            // 내 기본 캘린더는 지울 수 없다. 나머지는 줄 오른쪽에 ✕ 버튼이 있다:
            //  - StudyFlow에서 만든(내 소유의) 캘린더는 "삭제" = Google에서 완전히 지운다
            //  - 그 밖의 캘린더(공휴일, 공유받은 것, Google에서 직접 만든 것)는 "목록에서 빼기" = 내 목록에서만 뺀다
            if (!cal.primary) {
                const created = !!cal.owner && (settings.createdCalendarIds || []).includes(cal.id);
                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.className = "calendar-remove";
                removeButton.textContent = "✕";
                removeButton.title = created ? "이 캘린더 삭제" : "내 목록에서 빼기";
                removeButton.addEventListener("click", function (e) {
                    // 버튼은 label 안에 있어서, 막지 않으면 이 줄의 체크박스가 눌린다
                    e.preventDefault();
                    e.stopPropagation();
                    openCalendarRemoveDialog(cal, created);
                });
                label.appendChild(removeButton);
            }
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
        const message = document.createElement("p");
        message.className = "calendar-list-error";
        message.textContent = "캘린더 목록을 불러오지 못했습니다.";
        listElement.appendChild(message);
    }
}

// ----- 캘린더 만들기 / 지우기 -----
// "내 캘린더" 제목 옆의 + 로 Google에 새 캘린더를 만들고, 줄 끝의 ✕로 지운다. 폰과 웹의 Google Calendar에도 똑같이 반영된다.
// 지우기는 두 가지다. StudyFlow에서 만든 캘린더는 "삭제"(일정까지 완전히 지움, 되돌릴 수 없음), 그 밖의 캘린더는 "목록에서 빼기"(캘린더와 일정은 그대로).
// 이 구분은 Google의 권한 범위(calendar.app.created = 이 앱이 만든 캘린더만)와 같아서, 실수로 다른 캘린더를 지울 수 없다.
// 어떤 캘린더를 StudyFlow가 만들었는지는 만들 때 id를 설정(createdCalendarIds)에 적어 둬서 안다.

const calendarAddButton = document.getElementById("calendar-add-button");
const calendarAddDialog = document.getElementById("calendar-add-dialog");
const calendarNameInput = document.getElementById("calendar-name");
const calendarColorInput = document.getElementById("calendar-color");
const calendarAddError = document.getElementById("calendar-add-error");
const calendarAddSave = document.getElementById("calendar-add-save");
const calendarRemoveDialog = document.getElementById("calendar-remove-dialog");
const calendarRemoveTitle = document.getElementById("calendar-remove-title");
const calendarRemoveMessage = document.getElementById("calendar-remove-message");
const calendarRemoveError = document.getElementById("calendar-remove-error");
const calendarRemoveConfirm = document.getElementById("calendar-remove-confirm");
let removingCalendar = null;  // 지우기 창이 열려 있는 동안만 값이 있다: { calendar: 목록의 캘린더, permanent: 완전히 지우는가 }

// 캘린더 목록을 새로 받아 다시 그리고, 일정도 다시 불러온다
async function refreshAfterCalendarChange() {
    await loadCalendarList();
    reloadVisibleEvents();
}

calendarAddButton.addEventListener("click", function () {
    calendarNameInput.value = "";
    calendarAddError.textContent = "";
    calendarAddSave.disabled = false;
    calendarAddDialog.showModal();
    calendarNameInput.focus();
});
document.getElementById("calendar-add-cancel").addEventListener("click", function () {
    calendarAddDialog.close();
});

async function createCalendar() {
    const name = calendarNameInput.value.trim();
    if (!name) {
        calendarAddError.textContent = "캘린더 이름을 입력하세요.";
        return;
    }
    calendarAddError.textContent = "만드는 중...";
    calendarAddSave.disabled = true;  // 두 번 눌러 같은 캘린더가 둘 생기지 않게 한다
    try {
        const response = await fetch("/api/calendars", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: name, color: calendarColorInput.value }),
        });
        if (!response.ok) {
            throw new Error(await errorMessageFrom(response));
        }
        const created = await response.json();
        // 이 캘린더는 StudyFlow가 만들었다고 기억해 둔다 (그래서 "삭제"를 보여 줄 수 있다)
        settings.createdCalendarIds = (settings.createdCalendarIds || []).concat(created.id);
        saveSettings();
        calendarAddDialog.close();
        showToast("'" + name + "' 캘린더를 만들었습니다");
        await refreshAfterCalendarChange();
    } catch (error) {
        calendarAddError.textContent = error.message;
    } finally {
        calendarAddSave.disabled = false;
    }
}
calendarAddSave.addEventListener("click", createCalendar);
calendarNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.isComposing) {  // 한글 조합 중의 Enter는 글자를 확정하는 키라서 무시한다
        e.preventDefault();
        createCalendar();
    }
});

// 지우기 확인 창을 연다. permanent가 true면 완전히 지우기, false면 목록에서 빼기
function openCalendarRemoveDialog(cal, permanent) {
    removingCalendar = { calendar: cal, permanent: permanent };
    calendarRemoveError.textContent = "";
    calendarRemoveConfirm.disabled = false;
    if (permanent) {
        calendarRemoveTitle.textContent = "캘린더 삭제";
        calendarRemoveMessage.textContent = "'" + cal.name + "' 캘린더를 삭제할까요?\n이 캘린더의 일정이 모두 지워지고, 폰과 웹의 Google Calendar에서도 사라집니다. 되돌릴 수 없습니다.";
        calendarRemoveConfirm.textContent = "삭제";
        calendarRemoveConfirm.className = "danger";
    } else {
        calendarRemoveTitle.textContent = "목록에서 빼기";
        calendarRemoveMessage.textContent = "'" + cal.name + "' 캘린더를 내 목록에서 뺄까요?\n캘린더와 그 안의 일정은 지워지지 않습니다. Google Calendar에서 다시 추가할 수 있습니다.";
        calendarRemoveConfirm.textContent = "목록에서 빼기";
        calendarRemoveConfirm.className = "";
    }
    calendarRemoveDialog.showModal();
}
document.getElementById("calendar-remove-cancel").addEventListener("click", function () {
    calendarRemoveDialog.close();
});

calendarRemoveConfirm.addEventListener("click", async function () {
    if (!removingCalendar) {
        return;
    }
    const cal = removingCalendar.calendar;
    const mode = removingCalendar.permanent ? "delete" : "unsubscribe";
    calendarRemoveError.textContent = "처리하는 중...";
    calendarRemoveConfirm.disabled = true;
    try {
        await sendRequest("/api/calendars?calendarId=" + encodeURIComponent(cal.id) + "&mode=" + mode, "DELETE");
        // 이 캘린더를 가리키던 설정(만든 캘린더 기록, 숨김 목록, 기본 캘린더)을 정리한다
        settings.createdCalendarIds = (settings.createdCalendarIds || []).filter(function (id) {
            return id !== cal.id;
        });
        hiddenCalendarIds.delete(cal.id);
        settings.hiddenCalendarIds = Array.from(hiddenCalendarIds);
        if (settings.defaultCalendarId === cal.id) {
            settings.defaultCalendarId = "";
        }
        saveSettings();
        calendarRemoveDialog.close();
        showToast("'" + cal.name + "' 캘린더를 " + (mode === "delete" ? "삭제했습니다" : "목록에서 뺐습니다"));
        await refreshAfterCalendarChange();
    } catch (error) {
        calendarRemoveError.textContent = error.message;
    } finally {
        calendarRemoveConfirm.disabled = false;
    }
});

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
    // 오늘 탭에서 시간표의 블록을 끌거나 메모를 쓰는 중이면 시간표를 다시 그리지 않는다 (쓰던 글자와 끌던 블록이 사라진다). 다음 동기화 때 맞춰진다
    if (document.getElementById("today").classList.contains("active") && !isTimelineBusy()) {
        loadTimeline().catch(function (error) {
            console.error("시간표를 불러오지 못했습니다:", error);
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
