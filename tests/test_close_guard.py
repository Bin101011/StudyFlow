"""창을 닫기 직전에 쓴 글이 사라지지 않는지 (docs/review-2026-11.md의 N30), 파이썬 쪽 순서를 확인한다.

close_guard.py는 창 닫기를 한 번 막고, 화면에 남은 글을 저장하게 한 뒤, 쓰기 요청이 끝나면 닫는다.
이 저장 단계가 어떤 식으로 멈춰도 3초 안에는 꼭 닫혀야 한다. 진짜 창 대신 가짜 창으로 "멈춤"을 일부러 만들어 시간을 잰다.
(진짜 WebView2로 잰 결과는 문서의 진행 기록에 있다. 화면 쪽 저장은 tests/browser/close_test.mjs가 본다)
"""
import inspect
import os
import sys
import threading
import time

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(TESTS_DIR)
sys.path.insert(0, PROJECT_DIR)
import close_guard  # noqa: E402
import single_instance  # noqa: E402

failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


class FakeHandlers:
    """pywebview의 window.events.closing처럼 += 로 함수를 등록한다."""

    def __init__(self):
        self.items = []

    def __iadd__(self, item):
        self.items.append(item)
        return self


class FakeEvents:
    def __init__(self):
        self.closing = FakeHandlers()
        self.closed = threading.Event()


class FakeWindow:
    """pywebview 창을 흉내 낸다. answer: 화면 명령을 받았을 때 할 일(스크립트를 받아 값을 돌려준다).
    destroy_hangs=True면 닫기 명령이 돌아오지 않는다(창이 멈춘 상황)."""

    def __init__(self, answer, destroy_hangs=False):
        self.events = FakeEvents()
        self.answer = answer
        self.destroy_hangs = destroy_hangs
        self.scripts = []
        self.destroyed_at = None
        self.lock = threading.Lock()

    def press_close(self):
        """사용자가 X를 누른 것과 같다. 등록된 함수가 False를 돌려주면 닫기가 취소된다. 닫혔으면 True를 돌려준다."""
        results = [handler() for handler in self.events.closing.items]
        if False in results:
            return False
        self.events.closed.set()
        return True

    def evaluate_js(self, script):
        with self.lock:
            self.scripts.append(script)
        return self.answer(script)

    def destroy(self):
        self.destroyed_at = time.monotonic()
        if self.destroy_hangs:
            threading.Event().wait()  # 영원히 멈춘다 (데몬 스레드라 시험이 끝나면 같이 사라진다)
        self.press_close()  # 진짜 창도 destroy가 닫기 절차를 다시 거친다


def run_case(answer, destroy_hangs=False, wait=4.0):
    """창을 만들고 X를 한 번 누른 뒤, 닫히거나(또는 강제 종료되거나) wait초가 지날 때까지 기다린다."""
    window = FakeWindow(answer, destroy_hangs)
    exits = []
    exited = threading.Event()

    def fake_exit():
        exits.append(time.monotonic())
        exited.set()

    close_guard.install(window, exit_func=fake_exit)
    started = time.monotonic()
    first_press = window.press_close()
    deadline = started + wait
    while time.monotonic() < deadline and not window.events.closed.is_set() and not exited.is_set():
        time.sleep(0.005)
    took = time.monotonic() - started
    return {"window": window, "first_press": first_press, "took": took, "exits": exits, "closed": window.events.closed.is_set(), "started": started}


def counts_answer(counts):
    """쓰기 요청 수를 차례로 돌려주는 화면. 다 쓰면 마지막 값을 계속 돌려준다. 저장 시작 명령은 첫 값을 돌려준다."""
    values = list(counts)

    def answer(script):
        if "prepareToClose" in script:
            return values[0]
        return values.pop(0) if len(values) > 1 else values[0]
    return answer


print("--- 평소: 남은 쓰기가 없으면 바로 닫힌다 ---")
case = run_case(counts_answer([0]))
check("X를 처음 누르면 닫기가 막힌다", case["first_press"] is False)
check("쓸 것이 없으면 금방 닫힌다(0.5초 안)", case["closed"] and case["took"] < 0.5, f"{case['took']:.3f}초, 닫힘={case['closed']}")
check("화면에 저장 명령을 먼저 보낸다", "prepareToClose" in case["window"].scripts[0], case["window"].scripts[:1])
check("강제 종료는 일어나지 않는다", not case["exits"])

print("--- 쓰기가 끝날 때까지 기다린 뒤 닫는다 ---")
state = {"done_at": None, "pending": 2}


def finishing_answer(script):
    # 0.4초 뒤에 쓰기 2개가 끝나는 화면
    if state["done_at"] is None:
        state["done_at"] = time.monotonic() + 0.4
    if time.monotonic() >= state["done_at"]:
        return 0
    return state["pending"]


case = run_case(finishing_answer)
check("쓰기가 끝나기 전에는 닫지 않는다", case["window"].destroyed_at is not None and case["window"].destroyed_at >= state["done_at"], case["took"])
check("쓰기가 끝나면 곧 닫는다(1초 안)", case["closed"] and case["took"] < 1.0, f"{case['took']:.3f}초")

print("--- 쓰기가 잠깐 0이 됐다가 다시 시작해도 먼저 닫지 않는다 (앞 저장이 끝난 뒤 이어서 저장하는 경우) ---")
gap = {"start": None}


def gap_answer(script):
    # 처음 0.1초: 1개, 그다음 0.05초: 0개(이어 저장 직전의 틈), 그다음 0.2초: 1개, 그 뒤: 0개
    now = time.monotonic()
    if gap["start"] is None:
        gap["start"] = now
    elapsed = now - gap["start"]
    if elapsed < 0.1:
        return 1
    if elapsed < 0.15:
        return 0
    if elapsed < 0.35:
        return 1
    return 0


case = run_case(gap_answer)
check("틈에 닫지 않고 이어 저장이 끝난 뒤에 닫는다", case["window"].destroyed_at is not None and case["window"].destroyed_at - gap["start"] >= 0.35,
      case["window"].destroyed_at and case["window"].destroyed_at - gap["start"])

print("--- 저장 단계가 멈춰도 3초 안에 닫힌다 ---")
case = run_case(counts_answer([3]))
check("쓰기가 끝나지 않아도 3초 안에 닫힌다", case["closed"] and 2.0 < case["took"] <= 3.0, f"{case['took']:.3f}초, 닫힘={case['closed']}")
check("쓰기가 안 끝난 경우에 강제 종료는 안 한다(닫기 명령이 먹었으므로)", not case["exits"])


def hang_always(script):
    threading.Event().wait()


case = run_case(hang_always)
check("저장 명령이 돌아오지 않아도(시제품의 멈춤) 3초 안에 닫힌다", case["closed"] and case["took"] <= 3.0, f"{case['took']:.3f}초, 닫힘={case['closed']}")


def hang_after_first(script):
    if "prepareToClose" in script:
        return 1
    threading.Event().wait()


case = run_case(hang_after_first)
check("저장은 시작했는데 확인 명령이 멈춰도 3초 안에 닫힌다", case["closed"] and case["took"] <= 3.0, f"{case['took']:.3f}초, 닫힘={case['closed']}")


def raise_always(script):
    raise RuntimeError("화면 오류 흉내")


case = run_case(raise_always)
check("화면 명령이 오류를 내면 기다리지 않고 닫는다", case["closed"] and case["took"] < 0.5, f"{case['took']:.3f}초, 닫힘={case['closed']}")

print("--- 창 닫기 명령까지 멈추면 프로그램을 강제로 끝낸다 ---")
case = run_case(counts_answer([0]), destroy_hangs=True)
check("쓸 것이 없을 때: 닫기 명령이 멈추면 강제로 끝낸다", len(case["exits"]) == 1 and case["exits"][0] - case["started"] <= 1.0, case["exits"])
case = run_case(counts_answer([3]), destroy_hangs=True)
check("저장도 닫기도 멈추면 3초 안에 강제로 끝낸다", len(case["exits"]) == 1 and case["exits"][0] - case["started"] <= 3.0, case["exits"] and case["exits"][0] - case["started"])

print("--- X를 여러 번 눌러도 한 번만 처리한다 ---")
pressed = {"prepare": 0}


def counting_answer(script):
    if "prepareToClose" in script:
        pressed["prepare"] += 1
    return 1 if time.monotonic() - pressed.setdefault("t", time.monotonic()) < 0.3 else 0


window = FakeWindow(counting_answer)
exits = []
close_guard.install(window, exit_func=lambda: exits.append(1))
again = [window.press_close() for _ in range(3)]
window.events.closed.wait(2)
check("저장 중에 다시 누른 X도 막힌다", again == [False, False, False], again)
check("저장 명령은 한 번만 보낸다", pressed["prepare"] == 1, pressed)
check("한 번 눌렀을 때처럼 닫힌다", window.events.closed.is_set() and not exits)

print("--- 진짜 파일들이 서로 맞게 연결되어 있다 ---")
with open(os.path.join(PROJECT_DIR, "main.py"), encoding="utf-8") as f:
    main_source = f.read()
with open(os.path.join(PROJECT_DIR, "static", "app.js"), encoding="utf-8") as f:
    app_source = f.read()
position = {name: main_source.find(text) for name, text in {
    "create": "window = webview.create_window(", "install": "close_guard.install(window)", "start": "webview.start("}.items()}
check("main.py가 창을 만든 뒤, 띄우기 전에 설치한다", -1 not in position.values() and position["create"] < position["install"] < position["start"], position)
check("강제 종료 기본값이 single_instance.exit_now다", inspect.signature(close_guard.install).parameters["exit_func"].default is single_instance.exit_now)
check("app.js에 화면 쪽 함수가 있다 (prepareToClose)", "function prepareToClose(" in app_source)
check("app.js에 쓰기 수를 세는 변수가 있다 (pendingWrites)", "let pendingWrites = 0" in app_source)
check("화면 코드가 안 돌아도(빈 화면) 명령이 오류를 내지 않게 적혀 있다", "typeof prepareToClose" in close_guard.PREPARE_SCRIPT and "typeof pendingWrites" in close_guard.PENDING_SCRIPT)
check("제한 시간을 합쳐도 3초를 넘지 않는다", close_guard.FLUSH_LIMIT_SECONDS + close_guard.CLOSE_LIMIT_SECONDS <= 3)

sys.exit(1 if failures else 0)
