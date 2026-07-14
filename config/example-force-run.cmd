@echo off
REM This is an example template. Copy to _force_run.cmd for local use. Do not commit the real _force_run.cmd.

cd /d "%~dp0.."

set PROJECT_ROOT=%CD%
set ZOTERO_PROJECT_ROOT=%CD%
set DESKTOP_REVIEW_ROOT=review_results\文献评价
REM DESKTOP_REVIEW_ROOT is legacy feedback input only. Official outputs always go to review_results\文献评价.

REM Keep real secrets in .env. Do not hardcode tokens or keys here.
REM Do not force-run by default.
set review_results_FORCE_RUN=false
set FORCE_review_results_RUN=false

REM Uncomment only when you explicitly accept the risk of bypassing interval gating.
REM set review_results_FORCE_RUN=true
REM set FORCE_review_results_RUN=true

node workflow/tools/stage0/main.mjs --trigger=manual > "review_results\pipeline\_latest_force_run.log" 2>&1
echo EXIT_CODE=%ERRORLEVEL% >> "review_results\pipeline\_latest_force_run.log"
