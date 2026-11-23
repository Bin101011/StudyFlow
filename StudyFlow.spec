# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 설정 파일. StudyFlow를 exe로 묶을 때 무엇을 넣을지 적어 둔다.
# 직접 실행하지 말고 build_exe.ps1을 실행한다 (그 스크립트가 이 파일을 쓴다).
#
# 결과: dist\StudyFlow\StudyFlow.exe (+ 옆의 _internal 폴더. exe가 쓰는 라이브러리가 들어 있다. 같이 있어야 켜진다)
#
# 파일 하나짜리(onefile)가 아니라 폴더(onedir)로 만든 이유:
# onefile은 켤 때마다 묶인 파일 수십 MB를 임시 폴더에 풀어서 몇 초 늦게 뜬다. StudyFlow는 빨리 켜지는 것을 신경 써 왔다(N25).
from PyInstaller.utils.hooks import collect_data_files

datas = [
    # 화면 파일(HTML, CSS, JavaScript, 글꼴). Flask가 app.py 옆의 templates, static 폴더에서 찾으므로 같은 이름으로 넣는다
    ("templates", "templates"),
    ("static", "static"),
    ("studyflow.ico", "."),
]
# Google API 라이브러리가 쓰는 API 설명 파일(.json). 코드가 아니라서 따로 넣어 줘야 한다
datas += collect_data_files("googleapiclient")

# 앱 신분증(credentials.json)이 프로젝트 폴더에 있으면 exe 안에 같이 묶는다.
# 그러면 exe를 쓸 때 파일을 고를 필요 없이 설정 탭의 [연결하기]만 누르면 된다 (google_calendar.BUNDLED_CREDENTIALS_PATH).
# 이 파일은 .gitignore에 있어서 Git에는 올라가지 않는다. 대신 만든 exe 폴더를 남에게 주면 이 신분증도 같이 가므로 내 컴퓨터에서만 쓴다.
# token.json(로그인 결과)은 절대 묶지 않는다
import os
if os.path.exists("credentials.json"):
    datas.append(("credentials.json", "."))

a = Analysis(
    ["main.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    # 코드에서 바로 import하지 않아서 PyInstaller가 못 찾는 모듈. pywebview가 윈도우에서 쓰는 부분이다
    hiddenimports=["webview.platforms.edgechromium", "clr"],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="StudyFlow",
    icon="studyflow.ico",
    # console=False: 검은 터미널 창 없이 StudyFlow 창만 뜬다 (바로가기의 pythonw와 같은 효과).
    # 이때 print는 main.py가 studyflow.log(exe 옆)에 대신 적는다
    console=False,
    # upx: exe를 압축하는 도구. 백신이 오해하는 일이 늘어서 쓰지 않는다
    upx=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    upx=False,
    name="StudyFlow",
)
