# 파일 경로와 출력 장치를 다루는 파이썬 기본 도구
import os
import sys
# 뒤에서 따로 일을 시키는 도구 (남은 옛 작업 폴더 지우기)
import threading

# StudyFlow가 이미 켜져 있으면 두 번째 창을 띄우지 않고 안내만 하고 끝낸다 (자세한 이유는 single_instance.py).
# 방금 창을 닫아서 앞 프로그램이 아직 끝나는 중이면, 안내를 띄우기 전에 최대 5초 기다렸다가 켠다.
# 로그 파일을 여는 것보다 먼저 해야 한다: 켜져 있는 쪽이 쓰고 있는 로그를 두 번째 프로그램이 지워 버리지 않도록
import single_instance

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if not single_instance.acquire(os.path.join(BASE_DIR, "studyflow.lock")):
    single_instance.show_already_running_message()
    sys.exit(0)

# 바탕화면 바로가기는 터미널(검은 창) 없이 pythonw로 실행한다. 이때는 print가 글자를 보낼 곳이 없다.
# 그래서 같은 내용을 파일(studyflow.log)에 대신 적어두어, 문제가 생겼을 때 이유를 볼 수 있게 한다.
# (터미널에서 실행할 때는 sys.stdout이 있으므로 이 부분은 건너뛴다. 아래 import보다 먼저 와야 한다)
if sys.stdout is None or sys.stderr is None:
    log_path = os.path.join(BASE_DIR, "studyflow.log")
    # 1MB를 넘으면 새로 시작해서 파일이 계속 커지지 않게 한다 ("w": 새로 쓰기, "a": 이어 쓰기)
    mode = "w" if os.path.exists(log_path) and os.path.getsize(log_path) > 1_000_000 else "a"
    # buffering=1: 한 줄 쓸 때마다 바로 파일에 기록한다 (갑자기 꺼져도 마지막 기록이 남도록)
    sys.stdout = sys.stderr = open(log_path, mode, encoding="utf-8", buffering=1)

# pywebview 라이브러리를 가져온다 (웹 화면을 독립된 창에 담아주는 도구)
import webview

# app.py에서 만들어둔 Flask 앱과, 뒤에서 할 일을 시작하는 함수를 가져온다
from app import app, start_background_tasks

# 뒤에서(별도 스레드로) Google 연결 준비와 1분마다 하는 자동 동기화를 시작한다. 창이 뜨는 것을 막지 않는다
start_background_tasks()

# 창을 하나 만든다. 두 번째 자리에 Flask 앱을 넘기면
# pywebview가 알아서 서버를 켜고, 그 화면을 창에 보여준다
webview.create_window("StudyFlow", app, width=1200, height=800)

# 창 안의 브라우저(WebView2)가 쓰는 작업 폴더. 정하지 않으면 켤 때마다 %TEMP%에 새 폴더(tmpXXXX\EBWebView, 십수 MB)가 생기고,
# 끌 때 지우려다 실패해서(브라우저 프로세스가 아직 파일을 쥐고 있다) 쌓인다 (실제로 13일 만에 10개, 156MB였다).
# 그래서 %LOCALAPPDATA%\StudyFlow 안에 두고, 실행마다 새 이름(webview_profile-…)을 쓰며, 켤 때 남은 옛 폴더를 지운다.
# 실행마다 새 이름인 이유: 창을 닫아도 그 브라우저가 몇 초 더 폴더를 쥐고 있어서, 닫자마자 다시 켤 때 같은 폴더를 쓰면
# 화면만 뜨고 달력이 비었다 (docs/review-2026-11.md의 N25, 자세한 것은 single_instance.py).
# 주의 1: 이 폴더들은 지워진다. 그래서 반드시 이 용도로만 쓰는 전용 폴더여야 한다 (내 데이터가 든 폴더를 넣으면 안 된다).
# 주의 2: private_mode=False로 바꾸지 않았다. 그러면 pywebview가 서버 포트를 고정값(42001)으로 바꿔서, 그 포트를 다른 프로그램이 쓰고 있으면 앱이 안 뜬다.
# 폴더는 프로젝트 안이 아니라 %LOCALAPPDATA%에 둔다 (클라우드 동기화나 Git에 섞이지 않게)
WEBVIEW_ROOT = os.path.join(os.environ.get("LOCALAPPDATA") or BASE_DIR, "StudyFlow")
WEBVIEW_PROFILE = single_instance.new_webview_profile(WEBVIEW_ROOT)

# 남은 옛 작업 폴더는 뒤에서(별도 스레드로) 지운다. 창이 뜨는 것을 막지 않고, 아직 쓰이는 폴더는 다음에 켤 때 지운다
threading.Thread(target=single_instance.remove_old_webview_profiles, args=(WEBVIEW_ROOT, WEBVIEW_PROFILE), daemon=True).start()


def close_without_waiting():
    """창을 닫을 때 pywebview는 브라우저가 끝나기를 최대 3초 기다린 뒤 작업 폴더를 지운다. 그동안 프로그램이 끝나지 않아서
    닫자마자 다시 켜면 그만큼 늦게 떴다. 작업 폴더는 실행마다 새로 쓰고 다음에 켤 때 지우므로 기다릴 필요가 없다.
    그래서 pywebview의 그 함수(EdgeChrome.clear_user_data)를 "브라우저에 끝내라고만 알리기"로 바꿔 끼운다.
    pywebview 안쪽 이름이라 버전이 바뀌면 없을 수 있다(requirements.txt의 6.2.1 기준). 없으면 바꾸지 않고 원래대로(3초 기다림) 둔다.
    webview.start가 창을 띄운 뒤 별도 스레드에서 부른다 (그때는 pywebview가 그 부분을 이미 불러와 두었다)."""
    browser_class = getattr(sys.modules.get("webview.platforms.edgechromium"), "EdgeChrome", None)
    if browser_class is None or not hasattr(browser_class, "clear_user_data"):
        print("[종료 준비] pywebview 구조가 달라서 창을 닫을 때 브라우저를 기다리는 동작을 그대로 둡니다.")
        return

    def dispose_only(self):
        try:
            self.webview.Dispose()  # 창 안 브라우저에 끝내라고 알린다 (원래 함수의 첫 단계와 같다)
        except Exception as error:
            print(f"[종료] 창 안 브라우저 정리 실패: {error}")

    browser_class.clear_user_data = dispose_only


# 창을 실제로 띄운다. 창을 닫을 때까지 여기서 멈춰 있다
webview.start(close_without_waiting, storage_path=WEBVIEW_PROFILE)

# 창을 닫은 뒤 프로그램을 바로 끝낸다 (docs/review-2026-11.md의 N25).
# 그냥 두면 파이썬이 끝나는 절차에서 .NET 연결 도구(pythonnet)의 종료가 3~6초 걸려서, 닫고 바로 다시 켜면 그만큼 늦게 떴다.
# 먼저 창을 닫는 순간 화면이 보낸 저장 요청(노트·하루 메모)이 끝나기를 최대 5초 기다린 뒤, 종료 절차를 건너뛰고 끝낸다 (single_instance.py)
left = single_instance.wait_for_other_threads()
if left:
    print(f"[종료] 끝나지 않은 요청을 두고 끝냅니다: {', '.join(left)}")
single_instance.exit_now()
