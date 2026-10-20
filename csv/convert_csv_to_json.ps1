<#
.SYNOPSIS
    Converts the official Database of British and Irish Hills (DoBIH) CSV file
    into a streamlined, web-optimized JSON dataset.

.DESCRIPTION
    This script converts the comprehensive DoBIH CSV database (e.g. DoBIH_v18_5.csv)
    into a clean, structured JSON file (e.g. DoBIH_v18_5.json / dobih.json).

    Key Features & Design Principles:
    1. Memory-Efficient Streaming:
       - Uses [System.IO.StreamWriter] to stream records directly to disk as they are processed,
         preventing PowerShell OutOfMemory exceptions on large datasets (20,000+ hills).
    2. UTF-8 Without BOM Encoding:
       - Generates pure UTF-8 without Byte Order Marks ([System.Text.UTF8Encoding]::new($false))
         to guarantee seamless web server delivery and JSON parsing compatibility across all browsers.
    3. Payload Minimization:
       - Drops null or empty fields through Clean-Dict to significantly reduce JSON payload size.
       - Omits hardcoded external URLs, as all links (Google Maps, PeakFinder, Hill Bagging,
         MountainViews, Geograph, Streetmap) are generated dynamically by client-side code from
         coordinates and hill numbers.
    4. Type Coercion:
       - Automatically converts numeric strings into native integers or floating-point numbers.
    5. Classification Flags Extraction:
       - Aggregates all active binary list flags ('1' in CSV) into a compact 'categories' dictionary.

.INPUTS
    CSV file located in the script directory (defaults to DoBIH_v18_5.csv).

.OUTPUTS
    JSON file matching the CSV base name (e.g. DoBIH_v18_5.json) in the same directory.
#>

# -----------------------------------------------------------------------------
# 1. Resolve File Paths
# -----------------------------------------------------------------------------
# Determine the directory where this script is located
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { "." }

# Attempt to locate the primary DoBIH CSV release file
$csvPath = Join-Path $scriptDir "DoBIH_v18_5.csv"
if (-not (Test-Path $csvPath)) {
    $csvPath = Join-Path $scriptDir "DoBIH_v18_5_2.csv"
}
if (-not (Test-Path $csvPath)) {
    $csvPath = "DoBIH_v18_5.csv"
}

# The generated JSON file will match the base name of the CSV (e.g. DoBIH_v18_5.json)
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($csvPath)
$jsonPath = Join-Path $scriptDir "$baseName.json"

Write-Host "Reading CSV: $csvPath ..." -ForegroundColor Cyan
$rows = Import-Csv -Path $csvPath
$total = $rows.Count
Write-Host "Found $total rows. Processing..." -ForegroundColor Green

# -----------------------------------------------------------------------------
# 2. Initialize Stream Writer (UTF-8 Without BOM)
# -----------------------------------------------------------------------------
# $false argument indicates no Byte Order Mark (BOM), ensuring clean web loading
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$writer = [System.IO.StreamWriter]::new($jsonPath, $false, $utf8NoBom)
$writer.WriteLine("[")

# -----------------------------------------------------------------------------
# 3. Known Classification Flag Columns in DoBIH CSV
# -----------------------------------------------------------------------------
# In the DoBIH CSV, each list membership is represented by a column containing '1'
$flagNames = @(
    'Ma','Ma=','Hu','Hu=','Tu','Sim','5','M','MT','F','C','G','D','DT','Hew','N',
    'Dew','DDew','HF','4','3','2','1','0','W','WO','B','E','HHB','Sy','Fel',
    'CoH','CoH=','CoU','CoU=','CoA','CoA=','CoL','CoL=','SIB','sMa','sHu','sSim',
    's5','s4','Mur','CT','GT','BL','Bg','Y','Cm','T100','xMT','xC','xG','xN',
    'xDT','Dil','VL','A','Ca','Bin','O','Un'
)

# -----------------------------------------------------------------------------
# 4. Helper Functions
# -----------------------------------------------------------------------------

# Parses a raw string into an integer, float, or trimmed string, returning $null for whitespace
function Parse-Val ($val) {
    if ([string]::IsNullOrWhiteSpace($val)) { return $null }
    $trimmed = $val.Trim()
    $num = 0.0
    if ([double]::TryParse($trimmed, [ref]$num)) {
        if ($num -match '^-?\d+$') { return [int64]$num }
        return $num
    }
    return $trimmed
}

# Strips all null entries from an ordered dictionary to minimize payload size
function Clean-Dict ($dict) {
    $clean = [ordered]@{}
    foreach ($k in $dict.Keys) {
        $v = $dict[$k]
        if ($null -ne $v) {
            $clean[$k] = $v
        }
    }
    if ($clean.Count -eq 0) { return $null }
    return $clean
}

# -----------------------------------------------------------------------------
# 5. Row-by-Row Processing and Streaming
# -----------------------------------------------------------------------------
for ($i = 0; $i -lt $total; $i++) {
    $row = $rows[$i]

    # Create a clean lookup hashtable with whitespace-trimmed header names
    $data = @{}
    foreach ($p in $row.PSObject.Properties) {
        $data[$p.Name.Trim()] = $p.Value
    }

    # Extract all active list flags (where value equals '1')
    $flags = [ordered]@{}
    foreach ($f in $flagNames) {
        if ($data.ContainsKey($f) -and $data[$f] -eq '1') {
            $flags[$f] = $true
        }
    }

    # Administrative metadata block (County, Area, Island, Topo Section)
    $admin = Clean-Dict ([ordered]@{
        county      = Parse-Val $data['County']
        section     = Parse-Val $data['Section']
        sectionNum  = Parse-Val $data['_Section']
        topoSection = Parse-Val $data['Topo Section']
        area        = Parse-Val $data['Area']
        island      = Parse-Val $data['Island']
    })

    # Location & Coordinate block (Latitude, Longitude, OS Grid references, Easting/Northing)
    $loc = Clean-Dict ([ordered]@{
        gridRef   = Parse-Val $data['Grid ref']
        gridRef10 = Parse-Val $data['Grid ref 10']
        gridRefXY = Parse-Val $data['GridrefXY']
        latitude  = Parse-Val $data['Latitude']
        longitude = Parse-Val $data['Longitude']
        xCoord    = Parse-Val $data['Xcoord']
        yCoord    = Parse-Val $data['Ycoord']
    })

    # Elevation & Prominence block (Metres, Feet, Drop/Prominence, Col Height, Col Grid Reference)
    $elev = Clean-Dict ([ordered]@{
        metres     = Parse-Val $data['Metres']
        feet       = Parse-Val $data['Feet']
        dropMetres = Parse-Val $data['Drop']
        colHeight  = Parse-Val $data['Col height']
        colGridRef = Parse-Val $data['Col grid ref']
    })

    # Ordnance Survey paper map sheet numbers (1:50k Landranger, 1:25k Explorer)
    $maps = Clean-Dict ([ordered]@{
        map1_50k = Parse-Val $data['Map 1:50k']
        map1_25k = Parse-Val $data['Map 1:25k']
    })

    # Parent summit relationships (Parent Marilyn ID, MountainViews Number, SMC Parent ID)
    $parent = Clean-Dict ([ordered]@{
        smcId     = Parse-Val $data['Parent (SMC)']
        marilynId = Parse-Val $data['Parent (Ma)']
        mvNumber  = Parse-Val $data['MVNumber']
    })

    # Root record structure (links are omitted since they are generated dynamically by code)
    $record = Clean-Dict ([ordered]@{
        number         = Parse-Val $data['Number']
        name           = Parse-Val $data['Name']
        country        = Parse-Val $data['Country']
        feature        = Parse-Val $data['Feature']
        observations   = Parse-Val $data['Observations']
        survey         = Parse-Val $data['Survey']
        climbed        = Parse-Val $data['Climbed']
        countyTop      = Parse-Val $data['County Top']
        revision       = Parse-Val $data['Revision']
        comments       = Parse-Val $data['Comments']
        administrative = $admin
        location       = $loc
        elevation      = $elev
        maps           = $maps
        parent         = $parent
        categories     = if ($flags.Count -gt 0) { $flags } else { $null }
    })

    # Convert the individual record to JSON with indentation
    $jsonBlock = $record | ConvertTo-Json -Depth 4
    $lines = $jsonBlock -split "`r?`n"
    for ($j = 0; $j -lt $lines.Length; $j++) {
        $line = "  " + $lines[$j]
        # Append a comma after the closing brace of each record except the last one
        if ($j -eq ($lines.Length - 1) -and $i -lt ($total - 1)) {
            $writer.WriteLine($line + ",")
        } else {
            $writer.WriteLine($line)
        }
    }

    # Print periodic progress notifications in the terminal
    if ($i % 2500 -eq 0 -and $i -gt 0) {
        Write-Host "Processed $i of $total rows..." -ForegroundColor DarkGray
    }
}

# Close array and finalize file stream
$writer.WriteLine("]")
$writer.Dispose()
Write-Host "Done! Successfully converted $total hills to $jsonPath" -ForegroundColor Green