# 바탕화면에 StudyFlow 바로가기를 만든다. 한 번만 실행하면 된다.
# 바로가기를 더블클릭하면 터미널(검은 창) 없이 StudyFlow 창만 뜬다.
#
# 실행 방법 (PowerShell에서 이 폴더로 이동한 뒤):
#   powershell -ExecutionPolicy Bypass -File .\make_shortcut.ps1

# 이 스크립트가 있는 폴더 = StudyFlow 프로젝트 폴더
$root = $PSScriptRoot

# pythonw.exe는 python.exe와 똑같이 파이썬을 실행하지만 터미널 창을 열지 않는다.
# 가상환경(.venv)의 것을 써야 설치해둔 라이브러리를 쓸 수 있다
$pythonw = Join-Path $root ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $pythonw)) {
    Write-Host "pythonw.exe not found: $pythonw"
    Write-Host "Check that the .venv folder exists."
    exit 1
}

# 바탕화면 폴더 위치 (OneDrive로 옮겨진 바탕화면도 올바르게 찾는다)
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "StudyFlow.lnk"

# WScript.Shell: 윈도우가 바로가기(.lnk) 파일을 만들 수 있게 해주는 도구
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonw                      # 실행할 프로그램
$shortcut.Arguments = "main.py"                      # 그 프로그램에 넘길 파일
$shortcut.WorkingDirectory = $root                   # 이 폴더에서 실행 (credentials.json 등을 찾기 위해 필요)
$shortcut.IconLocation = (Join-Path $root "studyflow.ico")
$shortcut.Description = "StudyFlow planner"
$shortcut.Save()

Write-Host "Shortcut created: $shortcutPath"
