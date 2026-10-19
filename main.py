# 파일 경로와 출력 장치를 다루는 파이썬 기본 도구
import os
import sys

# 바탕화면 바로가기는 터미널(검은 창) 없이 pythonw로 실행한다. 이때는 print가 글자를 보낼 곳이 없다.
# 그래서 같은 내용을 파일(studyflow.log)에 대신 적어두어, 문제가 생겼을 때 이유를 볼 수 있게 한다.
# (터미널에서 실행할 때는 sys.stdout이 있으므로 이 부분은 건너뛴다. 아래 import보다 먼저 와야 한다)
if sys.stdout is None or sys.stderr is None:
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "studyflow.log")
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

# 창을 실제로 띄운다. 창을 닫을 때까지 여기서 멈춰 있다
webview.start()
