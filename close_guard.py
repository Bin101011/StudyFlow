# 창을 닫기 직전에 쓴 글이 사라지지 않게 하는 파일 (docs/review-2026-11.md의 N30).
#
# 왜 필요한가: 메모와 노트는 글을 쓰고 1~1.5초 뒤에 저장한다. 그 전에 창을 닫으면 화면이 "서둘러 저장" 요청을 보내지만,
# 창이 사라지는 속도와 경쟁이라서 요청이 서버에 못 오고 글이 조용히 사라질 때가 있었다(진짜 창에서 44번 중 14번).
#
# 어떻게: 창 닫기를 한 번 막고(사용자에게는 닫기가 약간 늦는 것으로만 보인다), 화면에 "남은 글을 저장해라"를 시킨 뒤,
# 쓰기 요청이 모두 끝나면 진짜로 닫는다.
#
# 가장 중요한 약속: 무슨 일이 있어도 3초 안에 창이 닫힌다. 저장 단계가 멈춰서 창이 안 닫히면 글 하나 잃는 것보다 나쁘다.
# 화면 명령(evaluate_js)에는 제한 시간이 없어서 실제로 돌아오지 않은 적이 있다. 그래서 저장 단계와 시간을 재는 쪽을 서로 다른 스레드로 나눈다.
import threading
import time

import single_instance

# 쓰기 요청이 끝나기를 기다리는 최대 시간(초). 이 시간이 지나면 끝나지 않았어도 닫는다
# (서버에 이미 도착한 요청은 main.py의 wait_for_other_threads가 창이 닫힌 뒤에도 끝까지 기다려 준다)
FLUSH_LIMIT_SECONDS = 2.4
# 닫기 명령을 내린 뒤 창이 실제로 닫히기를 기다리는 최대 시간(초). 이 시간이 지나면 프로그램을 강제로 끝낸다.
# 앞의 시간과 합쳐서 2.9초다. 시각을 재는 오차(수십 밀리초)가 더해져도 3초를 넘지 않게 여유를 뒀다
CLOSE_LIMIT_SECONDS = 0.5
# 쓰기 수가 0으로 이 시간(초) 동안 머물러야 "다 끝났다"고 본다. 앞 저장이 끝나고 이어서 다음 저장을 시작하기까지 아주 잠깐 0이 되는 틈이 있어서다
QUIET_SECONDS = 0.1
# 쓰기 수를 확인하는 간격(초)
POLL_SECONDS = 0.02

# 화면에 보내는 명령. app.js가 안 돌았을 때(빈 화면)도 오류가 나지 않도록 있는지 먼저 본다. prepareToClose는 static/app.js에 있다
PREPARE_SCRIPT = 'typeof prepareToClose === "function" ? prepareToClose() : 0'
PENDING_SCRIPT = 'typeof pendingWrites === "number" ? pendingWrites : 0'


def _flush(window, finished):
    """화면에 남은 글을 저장하게 하고, 쓰기 요청이 끝나거나 제한 시간이 될 때까지 기다린다. 끝나면 finished 신호를 켠다.
    이 함수는 evaluate_js에서 영원히 멈출 수 있다. 그래도 _watch가 시간을 재서 창을 닫는다."""
    try:
        window.evaluate_js(PREPARE_SCRIPT)
        deadline = time.monotonic() + FLUSH_LIMIT_SECONDS
        quiet_since = None
        while time.monotonic() < deadline:
            pending = window.evaluate_js(PENDING_SCRIPT)
            if isinstance(pending, (int, float)) and pending > 0:
                quiet_since = None
            elif quiet_since is None:
                quiet_since = time.monotonic()
            elif time.monotonic() - quiet_since >= QUIET_SECONDS:
                break
            time.sleep(POLL_SECONDS)
    except Exception as error:
        print(f"[창 닫기] 화면에 저장을 시키지 못했습니다: {error}")
    finally:
        finished.set()


def _destroy(window):
    try:
        window.destroy()
    except Exception as error:
        print(f"[창 닫기] 창을 닫지 못했습니다: {error}")


def _watch(window, finished, allow_close, exit_func):
    """저장 단계가 끝나거나 제한 시간이 되면 창을 닫는다. 그래도 창이 안 닫히면 프로그램을 끝낸다."""
    finished.wait(FLUSH_LIMIT_SECONDS)
    allow_close.set()
    # 닫기 명령 자체가 돌아오지 않을 수 있어서(창이 멈춘 경우) 또 다른 스레드에서 부른다
    threading.Thread(target=_destroy, args=(window,), daemon=True).start()
    if not window.events.closed.wait(CLOSE_LIMIT_SECONDS):
        print("[창 닫기] 창이 닫히지 않아 프로그램을 끝냅니다.")
        exit_func()


def install(window, exit_func=single_instance.exit_now):
    """window의 닫기를 위 순서로 처리하게 등록한다. webview.create_window 뒤, webview.start 전에 부른다.
    exit_func: 창이 끝내 안 닫힐 때 프로그램을 끝내는 함수 (시험에서는 가짜를 넣는다)"""
    finished = threading.Event()     # 저장 단계가 끝났다는 신호
    allow_close = threading.Event()  # 이제 진짜로 닫아도 된다는 신호
    started = threading.Lock()       # 저장 단계를 한 번만 시작하기 위한 열쇠 (X를 여러 번 눌러도)

    def on_closing():
        # X를 누르거나 Alt+F4, 작업 표시줄에서 닫기를 할 때마다 불린다. False를 돌려주면 pywebview가 닫기를 취소한다.
        # 창을 움직이는 스레드에서 불리므로 여기서 기다리면 안 된다 (기다리는 동안 창이 멈춘다)
        if allow_close.is_set():
            return True
        if started.acquire(blocking=False):
            # daemon=True: 이 스레드가 남아 있어도 프로그램이 끝나는 것을 막지 않는다
            threading.Thread(target=_flush, args=(window, finished), daemon=True).start()
            threading.Thread(target=_watch, args=(window, finished, allow_close, exit_func), daemon=True).start()
        return False

    window.events.closing += on_closing
