$ErrorActionPreference='Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
 dotnet publish src/UltracamStudio/UltracamStudio.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o release/win-x64
 if($LASTEXITCODE -ne 0) { throw 'Compilation echouee' }
 New-Item -ItemType Directory -Force release/win-x64/camera | Out-Null
 Copy-Item camera/* release/win-x64/camera -Recurse -Force
 New-Item -ItemType Directory -Force release/win-x64/licenses | Out-Null
 Copy-Item licenses/* release/win-x64/licenses -Recurse -Force
 Copy-Item README.md release/win-x64/README.md -Force
} finally { Pop-Location }
