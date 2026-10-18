# pywebview 라이브러리를 가져온다 (웹 화면을 독립된 창에 담아주는 도구)
import webview

# app.py에서 만들어둔 Flask 앱을 가져온다
from app import app

# 창을 하나 만든다. 두 번째 자리에 Flask 앱을 넘기면
# pywebview가 알아서 서버를 켜고, 그 화면을 창에 보여준다
webview.create_window("StudyFlow", app, width=1200, height=800)

# 창을 실제로 띄운다. 창을 닫을 때까지 여기서 멈춰 있다
webview.start()
