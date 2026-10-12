@echo off
chcp 65001 > nul
setlocal

echo ============================================
echo   رفع الفرع الحالي بأمان إلى origin
echo ============================================
echo.

where git > nul 2>&1
if errorlevel 1 (
    echo [X] git غير مثبت. نزّله من https://git-scm.com/download/win
    pause
    exit /b 1
)

git rev-parse --is-inside-work-tree > nul 2>&1
if errorlevel 1 (
    echo [X] هذا المجلد ليس مستودع Git. لا ينشئ هذا السكربت مستودعًا جديدًا.
    pause
    exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH (
    echo [X] لا يوجد فرع حالي؛ لن يتم اختيار فرع تلقائيًا.
    pause
    exit /b 1
)

git remote | findstr /x /c:"origin" > nul
if errorlevel 1 (
    echo [X] لا يوجد remote باسم origin. أعدّ remote يدويًا بعد التحقق من عنوانه.
    pause
    exit /b 1
)

echo الفرع الحالي: %CURRENT_BRANCH%
echo الملفات غير المحفوظة (لن تُضاف أو تُعمل لها commit تلقائيًا):
git status --short
echo.
echo هذا السكربت لا يغيّر الفرع أو remote، ولا يضيف ملفات ولا ينشئ commit.
echo سينفّذ فقط: git push -u origin HEAD
choice /c YN /m "هل تريد رفع commits الفرع الحالي الآن؟"
if errorlevel 2 exit /b 0

git push -u origin HEAD
if errorlevel 1 (
    echo [X] فشل الرفع. راجع رسالة git أعلاه.
    pause
    exit /b 1
)

echo [OK] تم رفع الفرع الحالي.
pause
endlocal
