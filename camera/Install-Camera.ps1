#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:ProgramFiles 'Ultracam Virtual Camera'
# Preserve any independent UnityCapture installation using the same CLSIDs.
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
 $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::ClassesRoot,$view)
 try {
  foreach ($id in @('{5c2cd55c-92ad-4999-8666-912bd3e70010}','{5c2cd55c-92ad-4999-8666-912bd3e70020}')) {
   $key=$hive.OpenSubKey("CLSID\$id\InprocServer32")
   if($key) { try { $existing=[string]$key.GetValue(''); if($existing -and -not $existing.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Un filtre UnityCapture est deja installe. Son installation est preservee ; utilisez cette camera existante ou desinstallez-la explicitement avant de poursuivre.' } } finally {$key.Dispose()} }
  }
 } finally {$hive.Dispose()}
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'UnityCaptureFilter*.dll') $target -Force
Copy-Item (Join-Path $PSScriptRoot 'LICENSE.UnityCapture.txt') $target -Force
Copy-Item (Join-Path $PSScriptRoot 'Uninstall-Camera.ps1') $target -Force
$registrations = @(
 @{ Tool = "$env:WINDIR\System32\regsvr32.exe"; Dll = 'UnityCaptureFilter64.dll' },
 @{ Tool = "$env:WINDIR\SysWOW64\regsvr32.exe"; Dll = 'UnityCaptureFilter32.dll' }
)
foreach ($item in $registrations) {
 $dll = Join-Path $target $item.Dll
 $proc = Start-Process $item.Tool -ArgumentList @('/s','"/i:UnityCaptureName=Ultracam Remote Camera"',('"'+$dll+'"')) -Wait -PassThru
 if ($proc.ExitCode -ne 0) { throw "Echec de l'inscription $($item.Dll) : $($proc.ExitCode)" }
}
if (-not (Get-NetFirewallRule -Name 'UltracamStudioLocal' -ErrorAction SilentlyContinue)) {
 New-NetFirewallRule -Name 'UltracamStudioLocal' -DisplayName 'Ultracam Studio - reseau prive' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 49721 -Profile Private -RemoteAddress LocalSubnet | Out-Null
}
Write-Host 'Camera installee : Ultracam Remote Camera. Redemarrez votre application video.'
Read-Host 'Appuyez sur Entree pour fermer'
