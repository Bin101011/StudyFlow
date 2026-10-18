# Flask 라이브러리에서 Flask 클래스를 가져온다
from flask import Flask, render_template

# Flask 앱(서버) 하나를 만든다. __name__은 "이 파일이 어디 있는지" 알려주는 값이다
app = Flask(__name__)


# 누군가 주소 "/"(맨 첫 페이지)로 접속하면 바로 아래 함수를 실행해라
@app.route("/")
def index():
    # templates 폴더의 index.html을 읽어서 돌려준다. 그 내용이 브라우저 화면에 표시된다
    return render_template("index.html")


# 이 파일을 직접 실행했을 때만 서버를 켠다
if __name__ == "__main__":
    # debug=True: 코드를 고치면 서버가 자동으로 다시 시작되고, 오류가 나면 자세히 보여준다
    app.run(debug=True)
