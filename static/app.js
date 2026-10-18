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

        // 캘린더마다 "체크박스 + 색 점 + 이름" 한 줄을 만든다
        calendars.forEach(function (cal) {
            // document.createElement: 자바스크립트로 HTML 요소를 새로 만든다
            const label = document.createElement("label");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = true; // 기본은 모두 선택

            // Google에서 정한 캘린더 색을 보여주는 작은 동그라미
            const dot = document.createElement("span");
            dot.className = "color-dot";
            dot.style.backgroundColor = cal.color;

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
    } catch (error) {
        console.error("캘린더 목록을 불러오지 못했습니다:", error);
        listElement.append("캘린더 목록을 불러오지 못했습니다.");
    }
}

// 위 함수를 실행한다 (함수는 만들기만 하면 실행되지 않고, 이렇게 불러야 실행된다)
loadCalendarList();
