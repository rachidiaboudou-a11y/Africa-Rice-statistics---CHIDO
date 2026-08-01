@echo off
REM Double-click this file to publish Rice Statistics for Africa to GitHub.
REM It must run in a real console window: GitHub's sign-in cannot appear in an
REM automated shell, which is why this step is a manual one.

cd /d "%~dp0"

echo ============================================================
echo   Rice Statistics for Africa - publish to GitHub
echo ============================================================
echo.
echo Remote:
git remote -v
echo.
echo Commits ready to push:
git log --oneline
echo.
echo A GitHub sign-in window will now open in your browser.
echo Authorise it there - do not type a password into this window.
echo.
pause

git push -u origin main

echo.
if errorlevel 1 (
  echo ------------------------------------------------------------
  echo  PUSH FAILED. The usual causes:
  echo.
  echo   * GitHub password not yet set - finish account setup first.
  echo   * Sign-in cancelled or timed out - just run this again.
  echo   * "Repository not found" - check you are signed in as
  echo     rachidiaboudou-a11y, the account that owns the repo.
  echo ------------------------------------------------------------
) else (
  echo ------------------------------------------------------------
  echo  PUSHED.
  echo.
  echo  NOW DO THIS - the site is not live until you do:
  echo.
  echo   1. Open Settings ^> Pages in the repository
  echo   2. Build and deployment ^> Source ^> choose "GitHub Actions"
  echo.
  echo  https://github.com/rachidiaboudou-a11y/Africa-Rice-statistics---CHIDO/settings/pages
  echo.
  echo  Your site appears about a minute later at:
  echo  https://rachidiaboudou-a11y.github.io/Africa-Rice-statistics---CHIDO/
  echo ------------------------------------------------------------
)
echo.
pause
