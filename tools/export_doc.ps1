# Export a .docx to PDF using the installed Word, and report the page count.
# Usage: powershell -File tools/export_doc.ps1 -Doc <abs .docx> -Out <abs .pdf>
param(
    [Parameter(Mandatory = $true)][string]$Doc,
    [Parameter(Mandatory = $true)][string]$Out
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $Doc)) { Write-Error "doc not found: $Doc" }

$word = $null
$d = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $d = $word.Documents.Open($Doc, $false, $true)       # readonly
    $pages = $d.ComputeStatistics(2)                      # 2 = wdStatisticPages
    $d.SaveAs([ref]$Out, [ref]17)                         # 17 = wdFormatPDF
    Write-Output ("pages: {0}" -f $pages)
    Write-Output ("pdf:   {0}" -f $Out)
}
finally {
    if ($d) { $d.Close($false) }
    if ($word) { $word.Quit() }
    if ($word) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null }
    [GC]::Collect()
}
