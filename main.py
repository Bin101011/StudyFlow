# 창을 띄우는 동안 뒤에서 다른 일을 동시에 시키기 위한 도구
import threading

# pywebview 라이브러리를 가져온다 (웹 화면을 독립된 창에 담아주는 도구)
import webview

# app.py에서 만들어둔 Flask 앱과, 미리 연결을 준비하는 함수를 가져온다
from app import app, warm_up

# 뒤에서(별도 스레드로) Google 연결을 미리 준비한다. 창이 뜨는 것을 막지 않는다.
# daemon=True: 창을 닫으면 이 작업이 남아 있어도 프로그램이 같이 끝나게 한다
threading.Thread(target=warm_up, daemon=True).start()

# 창을 하나 만든다. 두 번째 자리에 Flask 앱을 넘기면
# pywebview가 알아서 서버를 켜고, 그 화면을 창에 보여준다
webview.create_window("StudyFlow", app, width=1200, height=800)

# 창을 실제로 띄운다. 창을 닫을 때까지 여기서 멈춰 있다
webview.start()
