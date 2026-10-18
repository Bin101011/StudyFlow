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
    });
});
