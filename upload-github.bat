@echo off
chcp 65001 > nul
echo ============================================
echo    رفع المشروع على GitHub - بأمر واحد
echo ============================================
echo.

REM 1) نتأكد إن git متثبت
where git > nul 2>&1
if errorlevel 1 (
    echo [X] git مش متثبت على جهازك.
    echo     نزّله من: https://git-scm.com/download/win
    echo     وبعدين شغّل الملف ده تاني.
    pause
    exit /b 1
)

echo [1/5] بيجهّز git...
git init
git config core.autocrlf false

echo [2/5] بيختار الفرع الرئيسي...
git branch -M main

echo [3/5] بيضيف كل الملفات...
git add .
git status

echo [4/5] بيعمل commit...
git commit -m "first commit - worker app"

echo.
echo ============================================
echo    خطوة أخيرة — قولّي اليوزر بتاعك
echo ============================================
echo.
set /p GHUSER="اكتب اسم المستخدم بتاعك على GitHub: "

echo [5/5] بيربط المستودع...
git remote remove origin 2> nul
git remote add origin https://github.com/%GHUSER%/worker-app.git
git push -u origin main

echo.
echo ============================================
echo   خلص! لو فيه مشكلة، ابعتلي رسالة الخطأ
echo ============================================
pause
