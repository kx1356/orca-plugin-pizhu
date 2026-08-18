@echo off
chcp 65001 >nul
title orca-pizhu 一键部署
echo ========================================
echo  orca-pizhu 构建 + 部署到虎鲸插件目录
echo ========================================
echo.
cd /d "C:\Users\i5156\Desktop\OH-WorkSpace\orca-pizhu"

echo [1/2] 构建插件...
call npm run build
if errorlevel 1 (
    echo.
    echo 构建失败，请检查上方错误信息。
    pause
    exit /b 1
)

echo [2/2] 部署到虎鲸插件目录...
copy /y "dist\index.js" "C:\Users\i5156\Documents\orca\plugins\orca-pizhu\dist\index.js" >nul
if errorlevel 1 (
    echo.
    echo 部署失败，请检查插件目录是否存在。
    pause
    exit /b 1
)

echo.
echo ========================================
echo  部署完成！请彻底退出虎鲸后重新打开。
echo ========================================
pause
