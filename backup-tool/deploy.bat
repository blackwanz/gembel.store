@echo off
rem Double-click: backup dulu, terus deploy prod terbaru ke VPS (lihat deploy.py).
rem Ngecek doang tanpa ngubah server:  deploy.bat --dry
cd /d "%~dp0"
rem "py" (Python launcher) instead of "python": on this machine "python" resolves to the
rem Microsoft Store alias stub, which just prints "Python was not found" and does nothing.
py deploy.py %*
