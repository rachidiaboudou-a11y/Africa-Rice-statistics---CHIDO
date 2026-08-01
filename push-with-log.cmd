@echo off
REM Same as push-to-github.cmd, but records everything to push-log.txt so the
REM exact error can be read afterwards instead of guessed at.

cd /d "%~dp0"
set LOG=%~dp0push-log.txt

echo ============================================================
echo   Rice Statistics for Africa - publish to GitHub (logged)
echo ============================================================
echo.
echo Everything printed here is also saved to:
echo   %LOG%
echo.
echo A GitHub sign-in window should open in your browser.
echo Authorise it there. Do NOT type a password into this window.
echo.
pause

echo ==== run started %DATE% %TIME% ==== > "%LOG%"

echo. >> "%LOG%"
echo ---- git version ---- >> "%LOG%"
git --version >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ---- remote ---- >> "%LOG%"
git remote -v >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ---- local commits ---- >> "%LOG%"
git log --oneline >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ---- credential helper ---- >> "%LOG%"
git config --get credential.helper >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo ---- push ---- >> "%LOG%"
echo Pushing. If a browser window opens, sign in there.
git push -u origin main >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%

echo. >> "%LOG%"
echo ---- exit code: %RC% ---- >> "%LOG%"

echo. >> "%LOG%"
echo ---- remote branches after push ---- >> "%LOG%"
git branch -r >> "%LOG%" 2>&1

echo.
echo ============================================================
if "%RC%"=="0" (
  echo  PUSHED SUCCESSFULLY.
  echo.
  echo  Now switch Pages on - the site is NOT live until you do:
  echo  https://github.com/rachidiaboudou-a11y/Africa-Rice-statistics---CHIDO/settings/pages
  echo  Source ^> GitHub Actions
) else (
  echo  PUSH FAILED with exit code %RC%.
  echo.
  echo  The full error is saved in push-log.txt
  echo  Tell Claude "done" and it will read that file.
)
echo ============================================================
echo.
type "%LOG%"
echo.
echo (This window stays open. Press a key to close.)
pause
