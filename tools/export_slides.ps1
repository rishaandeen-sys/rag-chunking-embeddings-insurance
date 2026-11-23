# Export every slide of a .pptx to PNG using the installed PowerPoint.
# Usage:  powershell -File tools/export_slides.ps1 -Deck <abs .pptx> -Out <abs dir>
param(
    [Parameter(Mandatory = $true)][string]$Deck,
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Width = 1600
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Deck)) { Write-Error "deck not found: $Deck" }
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$ppt = $null
$pres = $null
try {
    $ppt = New-Object -ComObject PowerPoint.Application
    $pres = $ppt.Presentations.Open($Deck, $true, $false, $false)   # readonly, no window
    $h = [int]($Width * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
    $pres.SaveCopyAs($Out + "\deck.pdf", 32) | Out-Null              # 32 = ppSaveAsPDF
    for ($i = 1; $i -le $pres.Slides.Count; $i++) {
        $name = "{0}\slide-{1:d2}.png" -f $Out, $i
        $pres.Slides.Item($i).Export($name, "PNG", $Width, $h)
    }
    Write-Output ("exported {0} slides to {1}" -f $pres.Slides.Count, $Out)
}
finally {
    if ($pres) { $pres.Close() }
    if ($ppt) { $ppt.Quit() }
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
    [GC]::Collect()
}
